import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import { app, closeDatabase, db, initializeDatabase } from "../index.js";

const runId = `test-${Date.now()}`;
const userEmail = `${runId}@example.com`;
const username = runId;
const password = "Pass1234!";
const groupName = `Integration Group ${runId}`;
let createdGroupSlug = "";
let createdPostId = 0;
let createdCommentId = 0;

async function cleanup() {
  if (createdCommentId) {
    await db.query(`DELETE FROM comments WHERE id = $1`, [createdCommentId]);
  }

  if (createdPostId) {
    await db.query(`DELETE FROM comments WHERE post_id = $1`, [createdPostId]);
    await db.query(`DELETE FROM posts WHERE id = $1`, [createdPostId]);
  }

  if (createdGroupSlug) {
    await db.query(
      `DELETE FROM memberships WHERE group_id IN (SELECT id FROM groups WHERE slug = $1)`,
      [createdGroupSlug]
    );
    await db.query(`DELETE FROM groups WHERE slug = $1`, [createdGroupSlug]);
  }

  await db.query(`DELETE FROM users WHERE email = $1`, [userEmail]);
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