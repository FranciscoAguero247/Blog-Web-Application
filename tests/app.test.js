import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { app, closeDatabase, db, initializeDatabase } from "../index.js";

const runId = `test-${Date.now()}`;
const userEmail = `${runId}@example.com`;
const username = runId;
const password = "Pass1234!";
const groupName = `Integration Group ${runId}`;
const secondUserEmail = `member-${runId}@example.com`;
const secondUsername = `member-${runId}`;
const secondPassword = "Pass1234!";
const moderationUserEmail = `moderator-member-${runId}@example.com`;
const moderationUsername = `moderator-member-${runId}`;
const moderationPassword = "Pass1234!";
let createdGroupSlug = "";
let createdPostId = 0;
let createdCommentId = 0;
let memberPostId = 0;
let memberCommentId = 0;
let paginationPostIds = [];

async function cleanup() {
  if (createdCommentId) {
    await db.query(`DELETE FROM comments WHERE id = $1`, [createdCommentId]);
  }

  if (createdPostId) {
    await db.query(`DELETE FROM comments WHERE post_id = $1`, [createdPostId]);
    await db.query(`DELETE FROM posts WHERE id = $1`, [createdPostId]);
  }

  if (memberPostId) {
    await db.query(`DELETE FROM comments WHERE post_id = $1`, [memberPostId]);
    await db.query(`DELETE FROM posts WHERE id = $1`, [memberPostId]);
  }

  if (paginationPostIds.length > 0) {
    for (const postId of paginationPostIds) {
      await db.query(`DELETE FROM comments WHERE post_id = $1`, [postId]);
      await db.query(`DELETE FROM posts WHERE id = $1`, [postId]);
    }
  }

  if (createdGroupSlug) {
    await db.query(
      `DELETE FROM memberships WHERE group_id IN (SELECT id FROM groups WHERE slug = $1)`,
      [createdGroupSlug]
    );
    await db.query(`DELETE FROM groups WHERE slug = $1`, [createdGroupSlug]);
  }

  await db.query(`DELETE FROM users WHERE email = $1`, [userEmail]);
  await db.query(`DELETE FROM users WHERE email = $1`, [secondUserEmail]);
  await db.query(`DELETE FROM users WHERE email = $1`, [moderationUserEmail]);
}

test("MVP community flow works end to end", async (t) => {
  await initializeDatabase();
  const agent = request.agent(app);

  await t.test("profile requires login", async () => {
    const response = await agent.get("/profile");
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, "/login");
  });

  await t.test("user can sign up", async () => {
    const response = await agent
      .post("/signup")
      .type("form")
      .send({ username, email: userEmail, password });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, "/");
  });

  await t.test("user can create a group and is auto-joined", async () => {
    const response = await agent
      .post("/groups")
      .type("form")
      .send({
        name: groupName,
        description: "Integration test group for community flows.",
      });

    assert.equal(response.status, 302);
    createdGroupSlug = response.headers.location.replace("/groups/", "");
    assert.ok(createdGroupSlug.length > 0);

    const membership = await db.query(
      `
        SELECT 1
        FROM memberships
        INNER JOIN groups ON groups.id = memberships.group_id
        INNER JOIN users ON users.id = memberships.user_id
        WHERE groups.slug = $1 AND users.email = $2
      `,
      [createdGroupSlug, userEmail]
    );

    assert.equal(membership.rowCount, 1);
  });

  await t.test("group creator can manage group settings", async () => {
    const editPage = await agent.get(`/groups/${createdGroupSlug}/edit`);
    assert.equal(editPage.status, 200);
    assert.match(editPage.text, /Manage Community/);

    const updateResponse = await agent
      .post(`/groups/${createdGroupSlug}/edit`)
      .type("form")
      .send({ name: groupName, description: "Updated description from integration tests." });

    assert.equal(updateResponse.status, 302);
    assert.equal(updateResponse.headers.location, `/groups/${createdGroupSlug}`);

    const groupPage = await agent.get(`/groups/${createdGroupSlug}`);
    assert.match(groupPage.text, /Updated description from integration tests\./);
  });

  await t.test("new post page only lists joined groups", async () => {
    const response = await agent.get("/newpost");
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(groupName));
    assert.doesNotMatch(response.text, />Technology</);
  });

  await t.test("user can create a post in joined group", async () => {
    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);

    const response = await agent
      .post("/posts")
      .type("form")
      .send({ groupId: groupResult.rows[0].id, content: "Integration test post content" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `/groups/${createdGroupSlug}`);

    const postResult = await db.query(
      `
        SELECT posts.id
        FROM posts
        INNER JOIN users ON users.id = posts.user_id
        WHERE users.email = $1 AND posts.content = $2
        ORDER BY posts.created_at DESC
        LIMIT 1
      `,
      [userEmail, "Integration test post content"]
    );

    createdPostId = postResult.rows[0].id;
    assert.ok(createdPostId > 0);
  });

  await t.test("user can comment on own group post", async () => {
    const response = await agent
      .post(`/posts/${createdPostId}/comments`)
      .type("form")
      .send({ groupSlug: createdGroupSlug, content: "Integration test comment content" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `/groups/${createdGroupSlug}`);

    const commentResult = await db.query(
      `
        SELECT comments.id
        FROM comments
        INNER JOIN users ON users.id = comments.user_id
        WHERE users.email = $1 AND comments.content = $2
        ORDER BY comments.created_at DESC
        LIMIT 1
      `,
      [userEmail, "Integration test comment content"]
    );

    createdCommentId = commentResult.rows[0].id;
    assert.ok(createdCommentId > 0);
  });

  await t.test("profile shows joined groups, posts, and comments", async () => {
    const response = await agent.get("/profile");
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(`@${username}`));
    assert.match(response.text, new RegExp(groupName));
    assert.match(response.text, /Integration test post content/);
    assert.match(response.text, /Integration test comment content/);
  });

  await t.test("home feed can be filtered to joined groups", async () => {
    const allFeed = await agent.get("/");
    assert.equal(allFeed.status, 200);
    assert.match(allFeed.text, /All activity/);
    assert.match(allFeed.text, /Joined groups/);
    assert.match(allFeed.text, /Integration test post content/);

    const joinedFeed = await agent.get("/?feed=joined");
    assert.equal(joinedFeed.status, 200);
    assert.match(joinedFeed.text, /This view only shows posts from communities you joined\./);
    assert.match(joinedFeed.text, /Integration test post content/);
  });

  await t.test("user can edit owned post and comment", async () => {
    const postResponse = await agent
      .post(`/posts/${createdPostId}/edit`)
      .type("form")
      .send({ content: "Edited integration test post", returnTo: "/profile" });
    assert.equal(postResponse.status, 302);

    const commentResponse = await agent
      .post(`/comments/${createdCommentId}/edit`)
      .type("form")
      .send({ content: "Edited integration test comment", returnTo: "/profile" });
    assert.equal(commentResponse.status, 302);

    const response = await agent.get("/profile");
    assert.match(response.text, /Edited integration test post/);
    assert.match(response.text, /Edited integration test comment/);
  });

  await t.test("group page paginates older posts", async () => {
    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);

    for (let index = 1; index <= 5; index += 1) {
      const response = await agent
        .post("/posts")
        .type("form")
        .send({ groupId: groupResult.rows[0].id, content: `Pagination test post ${index}` });

      assert.equal(response.status, 302);

      const result = await db.query(
        `
          SELECT posts.id
          FROM posts
          INNER JOIN users ON users.id = posts.user_id
          WHERE users.email = $1 AND posts.content = $2
          ORDER BY posts.created_at DESC
          LIMIT 1
        `,
        [userEmail, `Pagination test post ${index}`]
      );

      paginationPostIds.push(result.rows[0].id);
    }

    const firstPage = await agent.get(`/groups/${createdGroupSlug}`);
    assert.equal(firstPage.status, 200);
    assert.match(firstPage.text, /Page 1 of 2/);
    assert.match(firstPage.text, /Next/);
    assert.doesNotMatch(firstPage.text, /Previous/);
    assert.match(firstPage.text, /Pagination test post 5/);
    assert.doesNotMatch(firstPage.text, /Edited integration test post/);

    const secondPage = await agent.get(`/groups/${createdGroupSlug}?page=2`);
    assert.equal(secondPage.status, 200);
    assert.match(secondPage.text, /Page 2 of 2/);
    assert.match(secondPage.text, /Previous/);
    assert.doesNotMatch(secondPage.text, /Next/);
    assert.match(secondPage.text, /Edited integration test post/);

    paginationPostIds = [];
  });

  await t.test("non-member cannot post in another group", async () => {
    const techGroup = await db.query(`SELECT id FROM groups WHERE slug = 'tech' LIMIT 1`);
    const response = await agent
      .post("/posts")
      .type("form")
      .send({ groupId: techGroup.rows[0].id, content: "Should be rejected" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, "/groups/tech");

    const rejectedPage = await agent.get("/groups/tech");
    assert.match(rejectedPage.text, /Join Technology before posting\./);
  });

  await t.test("non-creator member can leave a group", async () => {
    const memberAgent = request.agent(app);

    const signupResponse = await memberAgent
      .post("/signup")
      .type("form")
      .send({ username: secondUsername, email: secondUserEmail, password: secondPassword });
    assert.equal(signupResponse.status, 302);

    const joinResponse = await memberAgent.post(`/groups/${createdGroupSlug}/join`).type("form").send({});
    assert.equal(joinResponse.status, 302);
    assert.equal(joinResponse.headers.location, `/groups/${createdGroupSlug}`);

    const leaveResponse = await memberAgent.post(`/groups/${createdGroupSlug}/leave`).type("form").send({});
    assert.equal(leaveResponse.status, 302);
    assert.equal(leaveResponse.headers.location, `/groups/${createdGroupSlug}`);

    const memberCheck = await db.query(
      `
        SELECT 1
        FROM memberships
        INNER JOIN groups ON groups.id = memberships.group_id
        INNER JOIN users ON users.id = memberships.user_id
        WHERE groups.slug = $1 AND users.email = $2
      `,
      [createdGroupSlug, secondUserEmail]
    );
    assert.equal(memberCheck.rowCount, 0);
  });

  await t.test("group creator can remove a member post and comment", async () => {
    const memberAgent = request.agent(app);

    const signupResponse = await memberAgent
      .post("/signup")
      .type("form")
      .send({ username: moderationUsername, email: moderationUserEmail, password: moderationPassword });
    assert.equal(signupResponse.status, 302);

    const joinResponse = await memberAgent.post(`/groups/${createdGroupSlug}/join`).type("form").send({});
    assert.equal(joinResponse.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);

    const postResponse = await memberAgent
      .post("/posts")
      .type("form")
      .send({ groupId: groupResult.rows[0].id, content: "Member moderation test post" });
    assert.equal(postResponse.status, 302);

    const postResult = await db.query(
      `
        SELECT posts.id
        FROM posts
        INNER JOIN users ON users.id = posts.user_id
        WHERE users.email = $1 AND posts.content = $2
        ORDER BY posts.created_at DESC
        LIMIT 1
      `,
      [moderationUserEmail, "Member moderation test post"]
    );
    memberPostId = postResult.rows[0].id;

    const commentResponse = await memberAgent
      .post(`/posts/${memberPostId}/comments`)
      .type("form")
      .send({ groupSlug: createdGroupSlug, content: "Member moderation test comment" });
    assert.equal(commentResponse.status, 302);

    const commentResult = await db.query(
      `
        SELECT comments.id
        FROM comments
        INNER JOIN users ON users.id = comments.user_id
        WHERE users.email = $1 AND comments.content = $2
        ORDER BY comments.created_at DESC
        LIMIT 1
      `,
      [moderationUserEmail, "Member moderation test comment"]
    );
    memberCommentId = commentResult.rows[0].id;

    const creatorPostRemoval = await agent
      .post(`/groups/${createdGroupSlug}/posts/${memberPostId}/delete`)
      .type("form")
      .send({ returnTo: `/groups/${createdGroupSlug}` });
    assert.equal(creatorPostRemoval.status, 302);

    const creatorCommentRemoval = await agent
      .post(`/groups/${createdGroupSlug}/comments/${memberCommentId}/delete`)
      .type("form")
      .send({ returnTo: `/groups/${createdGroupSlug}` });
    assert.equal(creatorCommentRemoval.status, 302);

    const removedPost = await db.query(`SELECT 1 FROM posts WHERE id = $1`, [memberPostId]);
    const removedComment = await db.query(`SELECT 1 FROM comments WHERE id = $1`, [memberCommentId]);
    assert.equal(removedPost.rowCount, 0);
    assert.equal(removedComment.rowCount, 0);

    memberPostId = 0;
    memberCommentId = 0;
  });

  await t.test("creator cannot leave own group", async () => {
    const leaveResponse = await agent.post(`/groups/${createdGroupSlug}/leave`).type("form").send({});
    assert.equal(leaveResponse.status, 302);
    assert.equal(leaveResponse.headers.location, `/groups/${createdGroupSlug}`);

    const groupPage = await agent.get(`/groups/${createdGroupSlug}`);
    assert.match(groupPage.text, /Group creators cannot leave their own community\./);
  });

  await t.test("user can delete owned post and comment", async () => {
    const commentDeleteResponse = await agent
      .post(`/comments/${createdCommentId}/delete`)
      .type("form")
      .send({ returnTo: "/profile" });
    assert.equal(commentDeleteResponse.status, 302);

    createdCommentId = 0;

    const postDeleteResponse = await agent
      .post(`/posts/${createdPostId}/delete`)
      .type("form")
      .send({ returnTo: "/profile" });
    assert.equal(postDeleteResponse.status, 302);

    createdPostId = 0;

    const response = await agent.get("/profile");
    assert.doesNotMatch(response.text, /Edited integration test post/);
    assert.doesNotMatch(response.text, /Edited integration test comment/);
  });

  t.after(async () => {
    await cleanup();
    await closeDatabase();
  });
});