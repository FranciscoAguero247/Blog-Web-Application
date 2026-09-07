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
const reportUserEmail = `report-member-${runId}@example.com`;
const reportUsername = `report-member-${runId}`;
const reportPassword = "Pass1234!";
let createdGroupSlug = "";
let createdPostId = 0;
let createdCommentId = 0;
let memberPostId = 0;
let memberCommentId = 0;
let paginationPostIds = [];
let createdReportId = 0;
let createdCommentReportId = 0;

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

  if (createdReportId) {
    await db.query(`DELETE FROM content_reports WHERE id = $1`, [createdReportId]);
  }

  if (createdCommentReportId) {
    await db.query(`DELETE FROM content_reports WHERE id = $1`, [createdCommentReportId]);
  }

  if (createdGroupSlug) {
    await db.query(
      `DELETE FROM moderation_actions WHERE group_id IN (SELECT id FROM groups WHERE slug = $1)`,
      [createdGroupSlug]
    );
    await db.query(
      `DELETE FROM content_reports WHERE group_id IN (SELECT id FROM groups WHERE slug = $1)`,
      [createdGroupSlug]
    );
    await db.query(
      `DELETE FROM group_moderators WHERE group_id IN (SELECT id FROM groups WHERE slug = $1)`,
      [createdGroupSlug]
    );
    await db.query(
      `DELETE FROM memberships WHERE group_id IN (SELECT id FROM groups WHERE slug = $1)`,
      [createdGroupSlug]
    );
    await db.query(`DELETE FROM groups WHERE slug = $1`, [createdGroupSlug]);
  }

  await db.query(`DELETE FROM users WHERE email = $1`, [userEmail]);
  await db.query(`DELETE FROM users WHERE email = $1`, [secondUserEmail]);
  await db.query(`DELETE FROM users WHERE email = $1`, [moderationUserEmail]);
  await db.query(`DELETE FROM users WHERE email = $1`, [reportUserEmail]);
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

  await t.test("creator can assign a moderator to close reports", async () => {
    const reporterAgent = request.agent(app);
    const moderatorAgent = request.agent(app);

    const signupResponse = await reporterAgent
      .post("/signup")
      .type("form")
      .send({ username: reportUsername, email: reportUserEmail, password: reportPassword });
    assert.equal(signupResponse.status, 302);

    const joinResponse = await reporterAgent.post(`/groups/${createdGroupSlug}/join`).type("form").send({});
    assert.equal(joinResponse.status, 302);

    const nonModeratorQueue = await reporterAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(nonModeratorQueue.status, 302);
    assert.equal(nonModeratorQueue.headers.location, `/groups/${createdGroupSlug}`);

    const assignModerator = await agent
      .post(`/groups/${createdGroupSlug}/moderators`)
      .type("form")
      .send({ username: moderationUsername });
    assert.equal(assignModerator.status, 302);

    const moderatorMembership = await db.query(
      `
        SELECT 1
        FROM group_moderators
        INNER JOIN groups ON groups.id = group_moderators.group_id
        INNER JOIN users ON users.id = group_moderators.user_id
        WHERE groups.slug = $1 AND users.email = $2
      `,
      [createdGroupSlug, moderationUserEmail]
    );
    assert.equal(moderatorMembership.rowCount, 1);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const postReportResponse = await reporterAgent
      .post(`/groups/${createdGroupSlug}/posts/${createdPostId}/report`)
      .type("form")
      .send({ reason: "Spam", details: "Looks like spam content.", returnTo: `/groups/${createdGroupSlug}` });
    assert.equal(postReportResponse.status, 302);

    const commentReportResponse = await reporterAgent
      .post(`/groups/${createdGroupSlug}/comments/${createdCommentId}/report`)
      .type("form")
      .send({ reason: "Harassment", details: "Tone crosses community rules.", returnTo: `/groups/${createdGroupSlug}` });
    assert.equal(commentReportResponse.status, 302);

    const postReportResult = await db.query(
      `
        SELECT content_reports.id
        FROM content_reports
        INNER JOIN users ON users.id = content_reports.reporter_id
        WHERE users.email = $1 AND content_reports.post_id = $2 AND content_reports.status = 'open'
        LIMIT 1
      `,
      [reportUserEmail, createdPostId]
    );
    createdReportId = postReportResult.rows[0].id;

    const commentReportResult = await db.query(
      `
        SELECT content_reports.id
        FROM content_reports
        INNER JOIN users ON users.id = content_reports.reporter_id
        WHERE users.email = $1 AND content_reports.comment_id = $2 AND content_reports.status = 'open'
        LIMIT 1
      `,
      [reportUserEmail, createdCommentId]
    );
    createdCommentReportId = commentReportResult.rows[0].id;

    const moderationPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(moderationPage.status, 200);
    assert.match(moderationPage.text, /Moderation Queue/);
    assert.match(moderationPage.text, /Moderator Overview/);
    assert.match(moderationPage.text, /Open reports/i);
    assert.match(moderationPage.text, /Spam/);
    assert.match(moderationPage.text, /Harassment/);

    const resolvePostReport = await moderatorAgent
      .post(`/groups/${createdGroupSlug}/reports/${createdReportId}`)
      .type("form")
      .send({ action: "resolved", returnTo: `/groups/${createdGroupSlug}/moderation?status=open&page=2` });
    assert.equal(resolvePostReport.status, 302);
    assert.equal(resolvePostReport.headers.location, `/groups/${createdGroupSlug}/moderation?status=open&page=2`);

    const dismissCommentReport = await moderatorAgent
      .post(`/groups/${createdGroupSlug}/reports/${createdCommentReportId}`)
      .type("form")
      .send({ action: "dismissed", returnTo: `/groups/${createdGroupSlug}/moderation?status=open&page=2` });
    assert.equal(dismissCommentReport.status, 302);
    assert.equal(dismissCommentReport.headers.location, `/groups/${createdGroupSlug}/moderation?status=open&page=2`);

    const openQueue = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?status=open`);
    assert.equal(openQueue.status, 200);
    assert.match(openQueue.text, /Open \(active\)/);
    assert.match(openQueue.text, /No reports yet\. Everything is clear\./);

    const resolvedQueue = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?status=resolved`);
    assert.equal(resolvedQueue.status, 200);
    assert.match(resolvedQueue.text, /Resolved \(active\)/);
    assert.match(resolvedQueue.text, /Spam/);

    const dismissedQueue = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?status=dismissed`);
    assert.equal(dismissedQueue.status, 200);
    assert.match(dismissedQueue.text, /Dismissed \(active\)/);
    assert.match(dismissedQueue.text, /Harassment/);

    const closedReports = await db.query(
      `
        SELECT status
        FROM content_reports
        WHERE id = ANY($1::int[])
        ORDER BY id ASC
      `,
      [[createdReportId, createdCommentReportId]]
    );
    assert.equal(closedReports.rows.length, 2);
    assert.deepEqual(closedReports.rows.map((row) => row.status).sort(), ["dismissed", "resolved"]);

    const moderationActions = await db.query(
      `
        SELECT action_type
        FROM moderation_actions
        WHERE group_id IN (SELECT id FROM groups WHERE slug = $1)
          AND action_type = ANY($2::text[])
      `,
      [createdGroupSlug, ["moderator_added", "report_resolved", "report_dismissed"]]
    );
    assert.equal(moderationActions.rows.length, 3);

    const filteredActionHistory = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?actionType=report_resolved`);
    assert.equal(filteredActionHistory.status, 200);
    assert.match(filteredActionHistory.text, /Report Resolved \(active\)/);
    assert.match(filteredActionHistory.text, /Report marked as resolved/i);
    assert.doesNotMatch(filteredActionHistory.text, /Report marked as dismissed/i);

    createdReportId = 0;
    createdCommentReportId = 0;
  });

  await t.test("moderation queue paginates reports", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status, created_at)
        SELECT $1, $2, $3, 'Queue page test #' || gs::text, 'pagination', 'open', NOW() + (gs * INTERVAL '1 second')
        FROM generate_series(1, 11) AS gs
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );

    const firstPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?status=open`);
    assert.equal(firstPage.status, 200);
    assert.match(firstPage.text, /Page 1 of 2/);
    assert.match(firstPage.text, new RegExp(`/groups/${createdGroupSlug}/moderation\\?status=open&amp;page=2`));
    assert.match(firstPage.text, /Queue page test #11/);
    assert.doesNotMatch(firstPage.text, /Queue page test #1\b/);

    const secondPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?status=open&page=2`);
    assert.equal(secondPage.status, 200);
    assert.match(secondPage.text, /Page 2 of 2/);
    assert.match(secondPage.text, /Queue page test #1/);

    await db.query(`DELETE FROM content_reports WHERE reason LIKE 'Queue page test #%';`);
  });

  await t.test("moderation action history paginates and filters", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const moderatorUser = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [moderationUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(moderatorUser.rowCount, 1);

    await db.query(
      `
        INSERT INTO moderation_actions (group_id, actor_user_id, action_type, target_type, target_id, reason, target_snapshot, created_at)
        SELECT $1, $2, 'report_resolved', 'report', $3, 'pagination sequence', 'audit', NOW() + (gs * INTERVAL '1 second')
        FROM generate_series(1, 11) AS gs
      `,
      [groupResult.rows[0].id, moderatorUser.rows[0].id, createdReportId || 1]
    );

    const filteredPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?actionType=report_resolved`);
    assert.equal(filteredPage.status, 200);
    assert.match(filteredPage.text, /Action page 1 of 2/);
    assert.match(filteredPage.text, /Report Resolved \(active\)/);
    assert.match(filteredPage.text, /pagination sequence/i);

    const secondActionPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?actionType=report_resolved&actionsPage=2`);
    assert.equal(secondActionPage.status, 200);
    assert.match(secondActionPage.text, /Action page 2 of 2/);

    await db.query(
      `DELETE FROM moderation_actions WHERE group_id = $1 AND action_type = 'report_resolved' AND reason = 'pagination sequence';`,
      [groupResult.rows[0].id]
    );
  });

  await t.test("moderators can bulk resolve open reports", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const firstBulkReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'bulk report A', 'bulk action test', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );
    const secondBulkReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, comment_id, reason, details, status)
        VALUES ($1, $2, $3, 'bulk report B', 'bulk action test', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdCommentId]
    );

    const bulkResponse = await moderatorAgent
      .post(`/groups/${createdGroupSlug}/reports/bulk`)
      .type("form")
      .send({
        action: "resolved",
        reportIds: [firstBulkReport.rows[0].id, secondBulkReport.rows[0].id],
        returnTo: `/groups/${createdGroupSlug}/moderation`,
      });
    assert.equal(bulkResponse.status, 302);

    const bulkStatusRows = await db.query(
      `
        SELECT id, status
        FROM content_reports
        WHERE id = ANY($1::int[])
        ORDER BY id ASC
      `,
      [[firstBulkReport.rows[0].id, secondBulkReport.rows[0].id]]
    );
    assert.deepEqual(
      bulkStatusRows.rows.map((row) => row.status).sort(),
      ["resolved", "resolved"]
    );

    const actionRows = await db.query(
      `
        SELECT COUNT(*)::int AS total_count
        FROM moderation_actions
        WHERE group_id = $1
          AND action_type = 'report_resolved'
          AND target_id = ANY($2::int[])
      `,
      [groupResult.rows[0].id, [firstBulkReport.rows[0].id, secondBulkReport.rows[0].id]]
    );
    assert.equal(actionRows.rows[0].total_count, 2);

    await db.query(
      `DELETE FROM content_reports WHERE id = ANY($1::int[])`,
      [[firstBulkReport.rows[0].id, secondBulkReport.rows[0].id]]
    );
  });

  await t.test("moderators can search open reports by keyword", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const firstSearchReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'search keyword report', 'this should match search', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );
    const secondSearchReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, comment_id, reason, details, status)
        VALUES ($1, $2, $3, 'different report', 'should not match', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdCommentId]
    );

    const filteredPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?status=open&search=keyword`);
    assert.equal(filteredPage.status, 200);
    assert.match(filteredPage.text, /search keyword report/i);
    assert.doesNotMatch(filteredPage.text, /different report/i);

    await db.query(
      `DELETE FROM content_reports WHERE id = ANY($1::int[])`,
      [[firstSearchReport.rows[0].id, secondSearchReport.rows[0].id]]
    );
  });

  await t.test("moderators can filter reports by reporter username", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const primaryReporter = await db.query(`SELECT id, username FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(primaryReporter.rowCount, 1);

    const secondaryUserEmail = "secondary-reporter@example.com";
    const secondaryUserName = "secondaryreporter";
    const secondaryUser = await db.query(
      `
        INSERT INTO users (username, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, username
      `,
      [secondaryUserName, secondaryUserEmail, "placeholder-hash"]
    );

    await db.query(
      `
        INSERT INTO memberships (user_id, group_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, group_id) DO NOTHING
      `,
      [secondaryUser.rows[0].id, groupResult.rows[0].id]
    );

    const otherReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, comment_id, reason, details, status)
        VALUES ($1, $2, $3, 'reporter filter other user', 'should stay hidden', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, secondaryUser.rows[0].id, createdCommentId]
    );
    const matchingReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'reporter filter match', 'should show in filtered report list', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, primaryReporter.rows[0].id, createdPostId]
    );

    const filteredPage = await moderatorAgent.get(
      `/groups/${createdGroupSlug}/moderation?status=open&reporter=${encodeURIComponent(primaryReporter.rows[0].username)}`
    );
    assert.equal(filteredPage.status, 200);
    assert.match(filteredPage.text, /reporter filter match/i);
    assert.doesNotMatch(filteredPage.text, /reporter filter other user/i);

    await db.query(`DELETE FROM content_reports WHERE id = ANY($1::int[])`, [[otherReport.rows[0].id, matchingReport.rows[0].id]]);
    await db.query(`DELETE FROM memberships WHERE user_id = $1 AND group_id = $2`, [secondaryUser.rows[0].id, groupResult.rows[0].id]);
    await db.query(`DELETE FROM users WHERE email = $1`, [secondaryUserEmail]);
  });

  await t.test("moderators can filter reports by date range", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const oldReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status, created_at)
        VALUES ($1, $2, $3, 'old date report', 'should be excluded', 'open', NOW() - INTERVAL '15 days')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );
    const recentReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, comment_id, reason, details, status, created_at)
        VALUES ($1, $2, $3, 'recent date report', 'should be included', 'open', NOW() - INTERVAL '2 days')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdCommentId]
    );

    const today = new Date();
    const fromDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const filteredPage = await moderatorAgent.get(
      `/groups/${createdGroupSlug}/moderation?status=open&dateFrom=${fromDate}&dateTo=${toDate}`
    );
    assert.equal(filteredPage.status, 200);
    assert.match(filteredPage.text, /recent date report/i);
    assert.doesNotMatch(filteredPage.text, /old date report/i);

    await db.query(`DELETE FROM content_reports WHERE id = ANY($1::int[])`, [[oldReport.rows[0].id, recentReport.rows[0].id]]);
  });

  await t.test("moderators can add follow-up notes when closing reports", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const followUpReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'follow-up note report', 'must retain resolution note', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );

    const resolveResponse = await moderatorAgent
      .post(`/groups/${createdGroupSlug}/reports/${followUpReport.rows[0].id}`)
      .type("form")
      .send({
        action: "resolved",
        followUp: "We reviewed the post and kept it live after the review.",
        returnTo: `/groups/${createdGroupSlug}/moderation`,
      });
    assert.equal(resolveResponse.status, 302);

    const followUpPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?actionType=report_resolved`);
    assert.equal(followUpPage.status, 200);
    assert.match(followUpPage.text, /We reviewed the post and kept it live after the review\./i);

    await db.query(`DELETE FROM content_reports WHERE id = $1`, [followUpReport.rows[0].id]);
  });

  await t.test("reporters see follow-up notifications after a moderation action", async () => {
    const moderatorAgent = request.agent(app);
    const reporterAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const followUpReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'reporter notification test', 'should trigger a follow-up notice', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );

    const resolveResponse = await moderatorAgent
      .post(`/groups/${createdGroupSlug}/reports/${followUpReport.rows[0].id}`)
      .type("form")
      .send({
        action: "resolved",
        followUp: "The post was reviewed and kept live after the moderator check.",
        returnTo: `/groups/${createdGroupSlug}/moderation`,
      });
    assert.equal(resolveResponse.status, 302);

    const reporterLogin = await reporterAgent
      .post("/login")
      .type("form")
      .send({ email: reportUserEmail, password: reportPassword });
    assert.equal(reporterLogin.status, 302);

    const profilePage = await reporterAgent.get("/profile");
    assert.equal(profilePage.status, 200);
    assert.match(profilePage.text, /report update/i);
    assert.match(profilePage.text, /reviewed and kept live after the moderator check/i);

    await db.query(`DELETE FROM content_reports WHERE id = $1`, [followUpReport.rows[0].id]);
  });

  await t.test("moderation page shows a 7-day report trend summary", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const trendReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status, created_at)
        VALUES ($1, $2, $3, 'trend summary', 'this should appear in the 7-day trend', 'resolved', NOW() - INTERVAL '2 days'),
               ($1, $2, $3, 'trend summary two', 'this should also appear in the trend', 'open', NOW() - INTERVAL '1 day')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );

    const trendPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(trendPage.status, 200);
    assert.match(trendPage.text, /7-day report trend/i);
    assert.match(trendPage.text, /resolved|open/i);

    await db.query(`DELETE FROM content_reports WHERE id = ANY($1::int[])`, [[trendReport.rows[0].id, trendReport.rows[1].id]]);
  });

  await t.test("moderation page flags warning thresholds for repeat offenders", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    assert.equal(groupResult.rowCount, 1);

    const thresholdReporterEmail = "threshold-reporter@example.com";
    const thresholdReporterUsername = "thresholdreporter";
    const thresholdReporter = await db.query(
      `
        INSERT INTO users (username, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, username
      `,
      [thresholdReporterUsername, thresholdReporterEmail, "placeholder-hash"]
    );

    const thresholdPost = await db.query(
      `
        INSERT INTO posts (user_id, group_id, group_name, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [thresholdReporter.rows[0].id, groupResult.rows[0].id, "integration-group", "Threshold watch post"]
    );

    await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'threshold A', 'warning threshold test A', 'open'),
               ($1, $2, $3, 'threshold B', 'warning threshold test B', 'open'),
               ($1, $2, $3, 'threshold C', 'warning threshold test C', 'open')
      `,
      [groupResult.rows[0].id, thresholdReporter.rows[0].id, thresholdPost.rows[0].id]
    );

    const thresholdPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(thresholdPage.status, 200);
    assert.match(thresholdPage.text, /Warning threshold/i);
    assert.match(thresholdPage.text, /@thresholdreporter/i);
    assert.match(thresholdPage.text, /3 open reports/i);

    await db.query(`DELETE FROM content_reports WHERE group_id = $1 AND post_id = $2 AND reason IN ('threshold A', 'threshold B', 'threshold C')`, [groupResult.rows[0].id, thresholdPost.rows[0].id]);
    await db.query(`DELETE FROM posts WHERE id = $1`, [thresholdPost.rows[0].id]);
    await db.query(`DELETE FROM users WHERE email = $1`, [thresholdReporterEmail]);
  });

  await t.test("moderation action filters preserve report search and date filters", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const filteredPage = await moderatorAgent.get(
      `/groups/${createdGroupSlug}/moderation?status=open&search=keyword&reporter=${encodeURIComponent(reportUsername)}&dateFrom=2026-08-31&dateTo=2026-09-08`
    );
    assert.equal(filteredPage.status, 200);
    assert.match(filteredPage.text, /status=open.*search=keyword.*reporter=.*dateFrom=2026-08-31.*dateTo=2026-09-08.*actionType=report_resolved/i);
  });

  await t.test("moderation action filters include moderator and comment removal actions", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const actionFilterPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(actionFilterPage.status, 200);
    assert.match(
      actionFilterPage.text,
      new RegExp(`href="/groups/${createdGroupSlug}/moderation.*actionType=moderator_removed`, "i")
    );
    assert.match(
      actionFilterPage.text,
      new RegExp(`href="/groups/${createdGroupSlug}/moderation.*actionType=comment_removed`, "i")
    );
  });

  await t.test("moderation page surfaces escalation alerts for repeat offenders", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const authorEmail = "escalation-author@example.com";
    const authorUsername = "escalationauthor";
    const authorUser = await db.query(
      `
        INSERT INTO users (username, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, username
      `,
      [authorUsername, authorEmail, "placeholder-hash"]
    );

    const flaggedPost = await db.query(
      `
        INSERT INTO posts (user_id, group_id, group_name, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [authorUser.rows[0].id, groupResult.rows[0].id, "integration-group", "Escalation watch post"]
    );

    await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'repeat report', 'first escalation report', 'open'),
               ($1, $2, $3, 'repeat report', 'second escalation report', 'open')
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, flaggedPost.rows[0].id]
    );

    const escalationPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(escalationPage.status, 200);
    assert.match(escalationPage.text, /Escalation watch/i);
    assert.match(escalationPage.text, /repeat report/i);
    assert.match(escalationPage.text, /@report-member-test-/i);

    await db.query(`DELETE FROM content_reports WHERE group_id = $1 AND post_id = $2 AND reason = 'repeat report'`, [groupResult.rows[0].id, flaggedPost.rows[0].id]);
    await db.query(`DELETE FROM posts WHERE id = $1`, [flaggedPost.rows[0].id]);
    await db.query(`DELETE FROM users WHERE email = $1`, [authorEmail]);
  });

  await t.test("moderators can add follow-up notes when bulk updating reports", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const firstBulkFollowUp = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'bulk follow-up A', 'should be bulk updated', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );
    const secondBulkFollowUp = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, comment_id, reason, details, status)
        VALUES ($1, $2, $3, 'bulk follow-up B', 'should be bulk updated too', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdCommentId]
    );

    const bulkResponse = await moderatorAgent
      .post(`/groups/${createdGroupSlug}/reports/bulk`)
      .type("form")
      .send({
        action: "resolved",
        reportIds: [firstBulkFollowUp.rows[0].id, secondBulkFollowUp.rows[0].id],
        followUp: "Bulk review confirmed the reports were valid and no further action was needed.",
        returnTo: `/groups/${createdGroupSlug}/moderation`,
      });
    assert.equal(bulkResponse.status, 302);

    const bulkActionPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?actionType=report_resolved`);
    assert.equal(bulkActionPage.status, 200);
    assert.match(bulkActionPage.text, /Bulk review confirmed the reports were valid and no further action was needed\./i);

    await db.query(
      `DELETE FROM content_reports WHERE id = ANY($1::int[])`,
      [[firstBulkFollowUp.rows[0].id, secondBulkFollowUp.rows[0].id]]
    );
  });

  await t.test("moderation action history labels closure notes clearly", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const noteReport = await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'action history note', 'new note for audit trail', 'open')
        RETURNING id
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, createdPostId]
    );

    await moderatorAgent
      .post(`/groups/${createdGroupSlug}/reports/${noteReport.rows[0].id}`)
      .type("form")
      .send({
        action: "resolved",
        followUp: "The moderator reviewed the report and confirmed the content was acceptable.",
        returnTo: `/groups/${createdGroupSlug}/moderation?actionType=report_resolved`,
      });

    const actionHistoryPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation?actionType=report_resolved`);
    assert.equal(actionHistoryPage.status, 200);
    assert.match(actionHistoryPage.text, /Follow-up note:/i);
    assert.match(actionHistoryPage.text, /confirmed the content was acceptable/i);

    await db.query(`DELETE FROM content_reports WHERE id = $1`, [noteReport.rows[0].id]);
  });

  await t.test("moderation page shows community health signals", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const healthPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(healthPage.status, 200);
    assert.match(healthPage.text, /Community health signals/i);
    assert.match(healthPage.text, /Repeat reporters/i);
    assert.match(healthPage.text, /Flagged authors/i);
  });

  await t.test("moderation page shows a hot spots leaderboard", async () => {
    const moderatorAgent = request.agent(app);

    const moderatorLogin = await moderatorAgent
      .post("/login")
      .type("form")
      .send({ email: moderationUserEmail, password: moderationPassword });
    assert.equal(moderatorLogin.status, 302);

    const groupResult = await db.query(`SELECT id FROM groups WHERE slug = $1 LIMIT 1`, [createdGroupSlug]);
    const reporterResult = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [reportUserEmail]);
    assert.equal(groupResult.rowCount, 1);
    assert.equal(reporterResult.rowCount, 1);

    const hotAuthorUser = await db.query(
      `
        INSERT INTO users (username, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, username
      `,
      ["hotspotauthor", "hotspot-author@example.com", "placeholder-hash"]
    );

    const hotPost = await db.query(
      `
        INSERT INTO posts (user_id, group_id, group_name, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [hotAuthorUser.rows[0].id, groupResult.rows[0].id, "integration-group", "Hot spot post"]
    );

    await db.query(
      `
        INSERT INTO content_reports (group_id, reporter_id, post_id, reason, details, status)
        VALUES ($1, $2, $3, 'hotspot', 'first hot spot', 'open'),
               ($1, $2, $3, 'hotspot', 'second hot spot', 'open'),
               ($1, $2, $3, 'hotspot', 'third hot spot', 'open')
      `,
      [groupResult.rows[0].id, reporterResult.rows[0].id, hotPost.rows[0].id]
    );

    const leaderboardPage = await moderatorAgent.get(`/groups/${createdGroupSlug}/moderation`);
    assert.equal(leaderboardPage.status, 200);
    assert.match(leaderboardPage.text, /Hot spots/i);
    assert.match(leaderboardPage.text, /Hot spot post/i);
    assert.match(leaderboardPage.text, /3 reports/i);

    await db.query(`DELETE FROM content_reports WHERE group_id = $1 AND post_id = $2 AND reason = 'hotspot'`, [groupResult.rows[0].id, hotPost.rows[0].id]);
    await db.query(`DELETE FROM posts WHERE id = $1`, [hotPost.rows[0].id]);
    await db.query(`DELETE FROM users WHERE email = $1`, ["hotspot-author@example.com"]);
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