import express from "express";
import bodyParser from "body-parser";
import ejs from "ejs";
import * as path from 'path';
import { fileURLToPath } from 'url';
import PG from "pg";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcryptjs";

dotenv.config();

const DEFAULT_GROUPS = [
  {
    name: "Cars",
    slug: "cars",
    description: "Talk builds, restorations, motorsport, and the machines worth obsessing over.",
    legacyCategory: "Car",
  },
  {
    name: "Star Wars",
    slug: "star-wars",
    description: "Share theories, scenes, lore, and everything happening across the galaxy.",
    legacyCategory: "Star Wars",
  },
  {
    name: "Batman",
    slug: "batman",
    description: "For Gotham stories, detective arcs, villains, and the wider Bat-family.",
    legacyCategory: "Batman",
  },
  {
    name: "Technology",
    slug: "tech",
    description: "Discuss software, hardware, AI, and the tools shaping the future.",
    legacyCategory: "Tech",
  },
];

const legacyCategoryBySlug = new Map(
  DEFAULT_GROUPS.map((group) => [group.slug, group.legacyCategory])
);

const fallbackThemeBySlug = {
  cars: "car",
  "star-wars": "sw",
  batman: "batman",
  tech: "tech",
};

const db = new PG.Client({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "blog_web_app",
  password: process.env.DB_PASSWORD || "postgres",
  port: Number(process.env.DB_PORT || 5432),
});

async function initializeDatabase() {
  await db.connect();

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      slug VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      group_id INTEGER,
      group_name VARCHAR(100),
      category VARCHAR(50),
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER,
      user_id INTEGER,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      group_id INTEGER,
      UNIQUE (user_id, group_id),
      joined_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id INTEGER;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_id INTEGER;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS category VARCHAR(50);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_group_idx ON memberships(user_id, group_id);
    CREATE INDEX IF NOT EXISTS posts_group_id_idx ON posts(group_id);
    CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS comments_post_id_idx ON comments(post_id);
  `;

  await db.query(schemaSql);
  await seedDefaultGroups();
  await backfillLegacyPosts();
  console.log("Database schema verified");
}

async function seedDefaultGroups() {
  for (const group of DEFAULT_GROUPS) {
    await db.query(
      `
        INSERT INTO groups (name, slug, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description
      `,
      [group.name, group.slug, group.description]
    );
  }
}

async function backfillLegacyPosts() {
  for (const group of DEFAULT_GROUPS) {
    await db.query(
      `
        UPDATE posts
        SET group_id = groups.id,
            group_name = groups.name
        FROM groups
        WHERE groups.slug = $1
          AND posts.group_id IS NULL
          AND (posts.category = $2 OR posts.group_name = groups.name)
      `,
      [group.slug, group.legacyCategory]
    );
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    setFlash(req, "error", "Sign in to continue.");
    return res.redirect("/login");
  }

  return next();
}

async function getGroups(currentUserId) {
  const params = [];
  const membershipSelect = currentUserId
    ? `,
       BOOL_OR(memberships.user_id = $1) AS is_member`
    : ", FALSE AS is_member";

  if (currentUserId) {
    params.push(currentUserId);
  }

  const result = await db.query(
    `
      SELECT
        groups.id,
        groups.name,
        groups.slug,
        groups.description,
        COUNT(DISTINCT memberships.user_id) AS member_count,
        COUNT(DISTINCT posts.id) AS post_count
        ${membershipSelect}
      FROM groups
      LEFT JOIN memberships ON memberships.group_id = groups.id
      LEFT JOIN posts ON posts.group_id = groups.id
      GROUP BY groups.id
      ORDER BY groups.created_at ASC
    `,
    params
  );

  return result.rows.map((group) => ({
    ...group,
    member_count: Number(group.member_count || 0),
    post_count: Number(group.post_count || 0),
    is_member: group.is_member === true,
  }));
}

async function getRecentPosts(limit = 8) {
  const result = await db.query(
    `
      SELECT
        posts.id,
        posts.content,
        posts.created_at,
        COALESCE(users.username, 'Guest') AS username,
        COALESCE(groups.name, posts.group_name, posts.category, 'General') AS group_name,
        COALESCE(groups.slug, '') AS group_slug
      FROM posts
      LEFT JOIN users ON users.id = posts.user_id
      LEFT JOIN groups ON groups.id = posts.group_id
      ORDER BY posts.created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function getProfileSummary(userId) {
  const [groupResult, postResult, commentResult] = await Promise.all([
    db.query(
      `
        SELECT groups.id, groups.name, groups.slug, groups.description
        FROM memberships
        INNER JOIN groups ON groups.id = memberships.group_id
        WHERE memberships.user_id = $1
        ORDER BY memberships.joined_at DESC
      `,
      [userId]
    ),
    db.query(
      `
        SELECT
          posts.id,
          posts.user_id,
          posts.content,
          posts.created_at,
          COALESCE(groups.name, posts.group_name, posts.category, 'General') AS group_name,
          COALESCE(groups.slug, '') AS group_slug
        FROM posts
        LEFT JOIN groups ON groups.id = posts.group_id
        WHERE posts.user_id = $1
        ORDER BY posts.created_at DESC
      `,
      [userId]
    ),
    db.query(
      `
        SELECT
          comments.id,
          comments.user_id,
          comments.content,
          comments.created_at,
          posts.id AS post_id,
          COALESCE(groups.name, posts.group_name, posts.category, 'General') AS group_name,
          COALESCE(groups.slug, '') AS group_slug
        FROM comments
        INNER JOIN posts ON posts.id = comments.post_id
        LEFT JOIN groups ON groups.id = posts.group_id
        WHERE comments.user_id = $1
        ORDER BY comments.created_at DESC
      `,
      [userId]
    ),
  ]);

  return {
    groups: groupResult.rows,
    posts: postResult.rows,
    comments: commentResult.rows,
  };
}

async function getGroupBySlug(slug) {
  const result = await db.query(
    `SELECT id, name, slug, description, created_by, created_at FROM groups WHERE slug = $1`,
    [slug]
  );
  return result.rows[0] || null;
}

async function getPostsForGroup(group) {
  const legacyCategory = legacyCategoryBySlug.get(group.slug) || null;
  const params = [group.id, group.name, legacyCategory];

  const result = await db.query(
    `
      SELECT
        posts.id,
        posts.user_id,
        posts.content,
        posts.created_at,
        COALESCE(users.username, 'Guest') AS username,
        COALESCE(groups.name, posts.group_name, $2) AS group_name
      FROM posts
      LEFT JOIN users ON users.id = posts.user_id
      LEFT JOIN groups ON groups.id = posts.group_id
      WHERE posts.group_id = $1
         OR (posts.group_id IS NULL AND posts.group_name = $2)
         OR ($3::text IS NOT NULL AND posts.group_id IS NULL AND posts.category = $3)
      ORDER BY posts.created_at DESC
    `,
    params
  );

  return result.rows;
}

async function getCommentsForPostIds(postIds) {
  if (!postIds.length) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        comments.id,
        comments.post_id,
        comments.user_id,
        comments.content,
        comments.created_at,
        COALESCE(users.username, 'Guest') AS username
      FROM comments
      LEFT JOIN users ON users.id = comments.user_id
      WHERE comments.post_id = ANY($1::int[])
      ORDER BY comments.created_at ASC
    `,
    [postIds]
  );

  const commentsByPostId = new Map();
  for (const row of result.rows) {
    const postId = Number(row.post_id);
    if (!commentsByPostId.has(postId)) {
      commentsByPostId.set(postId, []);
    }
    commentsByPostId.get(postId).push(row);
  }

  return commentsByPostId;
}

async function isGroupMember(userId, groupId) {
  const result = await db.query(
    `SELECT 1 FROM memberships WHERE user_id = $1 AND group_id = $2 LIMIT 1`,
    [userId, groupId]
  );

  return result.rowCount > 0;
}

async function getWritableGroupForUser(userId, groupSlug) {
  const group = await getGroupBySlug(groupSlug);
  if (!group) {
    return { group: null, error: "That community no longer exists." };
  }

  const member = await isGroupMember(userId, group.id);
  if (!member) {
    return { group: null, error: `Join ${group.name} before posting or commenting.` };
  }

  return { group, error: null };
}

async function createPostForGroup({ userId, groupSlug, content }) {
  const group = await getGroupBySlug(groupSlug);

  if (!group) {
    return null;
  }

  await db.query(
    `
      INSERT INTO posts (user_id, group_id, group_name, category, content)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      userId,
      group.id,
      group.name,
      legacyCategoryBySlug.get(group.slug) || group.name,
      content,
    ]
  );

  return group;
}

async function getOwnedPostForUser(userId, postId) {
  const result = await db.query(
    `
      SELECT
        posts.id,
        posts.group_id,
        COALESCE(groups.slug, '') AS group_slug,
        COALESCE(groups.name, posts.group_name, posts.category, 'General') AS group_name
      FROM posts
      LEFT JOIN groups ON groups.id = posts.group_id
      WHERE posts.id = $1 AND posts.user_id = $2
      LIMIT 1
    `,
    [postId, userId]
  );

  return result.rows[0] || null;
}

async function getOwnedCommentForUser(userId, commentId) {
  const result = await db.query(
    `
      SELECT
        comments.id,
        comments.post_id,
        COALESCE(groups.slug, '') AS group_slug,
        COALESCE(groups.name, posts.group_name, posts.category, 'General') AS group_name
      FROM comments
      INNER JOIN posts ON posts.id = comments.post_id
      LEFT JOIN groups ON groups.id = posts.group_id
      WHERE comments.id = $1 AND comments.user_id = $2
      LIMIT 1
    `,
    [commentId, userId]
  );

  return result.rows[0] || null;
}

function getSafeReturnPath(candidatePath, fallbackPath = "/profile") {
  if (typeof candidatePath === "string" && candidatePath.startsWith("/")) {
    return candidatePath;
  }

  return fallbackPath;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "development-session-secret",
    resave: false,
    saveUninitialized: false,
  })
);
app.use('/public', express.static('public'));

app.set("view engine", "ejs");
app.engine("ejs", ejs.__express);
app.set("views", path.join(__dirname, "./views"));
app.use(express.static(__dirname + "/public/"));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.get("/", async (req, res) => {
  const groups = await getGroups(req.session.user?.id);
  const recentPosts = await getRecentPosts();
  res.render("index.ejs", { theme: "home", groups, recentPosts });
});

app.get("/about", (req, res) => {
  res.render("about.ejs", { theme: "newpost" });
});

app.get("/profile", requireAuth, async (req, res) => {
  const summary = await getProfileSummary(req.session.user.id);
  res.render("profile.ejs", {
    theme: "newpost",
    joinedGroups: summary.groups,
    userPosts: summary.posts,
    userComments: summary.comments,
  });
});

app.get("/signup", (req, res) => {
  res.render("signup.ejs", { theme: "newpost" });
});

app.post("/signup", async (req, res) => {
  const username = req.body.username?.trim();
  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password || "";

  if (!username || !email || password.length < 6) {
    setFlash(req, "error", "Use a username, a valid email, and a password with at least 6 characters.");
    return res.redirect("/signup");
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `
        INSERT INTO users (username, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, username, email
      `,
      [username, email, passwordHash]
    );

    req.session.user = result.rows[0];
    setFlash(req, "success", "Account created. You can now join groups and post.");
    return res.redirect("/");
  } catch (error) {
    console.error(error);
    setFlash(req, "error", "That username or email is already in use.");
    return res.redirect("/signup");
  }
});

app.get("/login", (req, res) => {
  res.render("login.ejs", { theme: "newpost" });
});

app.post("/login", async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password || "";

  try {
    const result = await db.query(
      `SELECT id, username, email, password_hash FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    const user = result.rows[0];

    if (!user) {
      setFlash(req, "error", "No account found for that email.");
      return res.redirect("/login");
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash || "");
    if (!passwordMatches) {
      setFlash(req, "error", "Incorrect password.");
      return res.redirect("/login");
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
    };

    setFlash(req, "success", `Welcome back, ${user.username}.`);
    return res.redirect("/");
  } catch (error) {
    console.error(error);
    setFlash(req, "error", "Could not sign in right now.");
    return res.redirect("/login");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/groups/new", requireAuth, (req, res) => {
  res.render("group-form.ejs", { theme: "newpost" });
});

app.post("/groups", requireAuth, async (req, res) => {
  const name = req.body.name?.trim();
  const description = req.body.description?.trim() || "";
  const slug = slugify(name || "");

  if (!name || !slug) {
    setFlash(req, "error", "Give the group a name before creating it.");
    return res.redirect("/groups/new");
  }

  try {
    const insertResult = await db.query(
      `
        INSERT INTO groups (name, slug, description, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING id, slug
      `,
      [name, slug, description, req.session.user.id]
    );

    const groupId = insertResult.rows[0].id;
    await db.query(
      `
        INSERT INTO memberships (user_id, group_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, group_id) DO NOTHING
      `,
      [req.session.user.id, groupId]
    );

    setFlash(req, "success", `${name} is live. Invite people to join and start posting.`);
    return res.redirect(`/groups/${slug}`);
  } catch (error) {
    console.error(error);
    setFlash(req, "error", "That group name is already taken.");
    return res.redirect("/groups/new");
  }
});

app.post("/groups/:slug/join", requireAuth, async (req, res) => {
  const group = await getGroupBySlug(req.params.slug);

  if (!group) {
    setFlash(req, "error", "That community does not exist.");
    return res.redirect("/");
  }

  await db.query(
    `
      INSERT INTO memberships (user_id, group_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, group_id) DO NOTHING
    `,
    [req.session.user.id, group.id]
  );

  setFlash(req, "success", `You joined ${group.name}.`);
  return res.redirect(`/groups/${group.slug}`);
});

app.get("/newpost", requireAuth, async (req, res) => {
  const groups = (await getGroups(req.session.user.id)).filter((group) => group.is_member);
  res.render("newpost.ejs", { theme: "newpost", groups });
});

app.post("/posts", requireAuth, async (req, res) => {
  const content = req.body.content?.trim();
  const groupId = Number(req.body.groupId);

  if (!content || !groupId) {
    setFlash(req, "error", "Choose a community and write something before posting.");
    return res.redirect("/newpost");
  }

  const result = await db.query(
    `SELECT id, name, slug FROM groups WHERE id = $1 LIMIT 1`,
    [groupId]
  );
  const group = result.rows[0];

  if (!group) {
    setFlash(req, "error", "That community no longer exists.");
    return res.redirect("/newpost");
  }

  const canWrite = await isGroupMember(req.session.user.id, group.id);
  if (!canWrite) {
    setFlash(req, "error", `Join ${group.name} before posting.`);
    return res.redirect(`/groups/${group.slug}`);
  }

  await createPostForGroup({
    userId: req.session.user.id,
    groupSlug: group.slug,
    content,
  });

  setFlash(req, "success", `Your post is live in ${group.name}.`);
  return res.redirect(`/groups/${group.slug}`);
});

app.post("/posts/:postId/comments", requireAuth, async (req, res) => {
  const postId = Number(req.params.postId);
  const groupSlug = req.body.groupSlug;
  const content = req.body.content?.trim();
  const legacyCategory = legacyCategoryBySlug.get(groupSlug) || null;

  if (!Number.isInteger(postId) || postId <= 0) {
    setFlash(req, "error", "Invalid post selected for comment.");
    return res.redirect(groupSlug ? `/groups/${groupSlug}` : "/");
  }

  const { group, error } = await getWritableGroupForUser(req.session.user.id, groupSlug);
  if (!group) {
    setFlash(req, "error", error);
    return res.redirect(groupSlug ? `/groups/${groupSlug}` : "/");
  }

  if (!content) {
    setFlash(req, "error", "Write a comment before posting.");
    return res.redirect(groupSlug ? `/groups/${groupSlug}` : "/");
  }

  const postResult = await db.query(
    `
      SELECT posts.id
      FROM posts
      WHERE posts.id = $1
        AND (
          posts.group_id = $2
          OR (posts.group_id IS NULL AND posts.group_name = $3)
          OR ($4::text IS NOT NULL AND posts.group_id IS NULL AND posts.category = $4)
        )
      LIMIT 1
    `,
    [postId, group.id, group.name, legacyCategory]
  );
  if (postResult.rowCount === 0) {
    setFlash(req, "error", "The post no longer exists.");
    return res.redirect(`/groups/${group.slug}`);
  }

  await db.query(
    `
      INSERT INTO comments (post_id, user_id, content)
      VALUES ($1, $2, $3)
    `,
    [postId, req.session.user.id, content]
  );

  setFlash(req, "success", "Comment posted.");
  return res.redirect(`/groups/${group.slug}`);
});

app.post("/posts/:postId/edit", requireAuth, async (req, res) => {
  const postId = Number(req.params.postId);
  const content = req.body.content?.trim();
  const ownedPost = await getOwnedPostForUser(req.session.user.id, postId);
  const fallbackPath = ownedPost?.group_slug ? `/groups/${ownedPost.group_slug}` : "/profile";
  const returnPath = getSafeReturnPath(req.body.returnTo, fallbackPath);

  if (!ownedPost) {
    setFlash(req, "error", "You can only edit your own posts.");
    return res.redirect(returnPath);
  }

  if (!content) {
    setFlash(req, "error", "Post content cannot be empty.");
    return res.redirect(returnPath);
  }

  await db.query(`UPDATE posts SET content = $1 WHERE id = $2`, [content, postId]);
  setFlash(req, "success", "Post updated.");
  return res.redirect(returnPath);
});

app.post("/posts/:postId/delete", requireAuth, async (req, res) => {
  const postId = Number(req.params.postId);
  const ownedPost = await getOwnedPostForUser(req.session.user.id, postId);
  const fallbackPath = ownedPost?.group_slug ? `/groups/${ownedPost.group_slug}` : "/profile";
  const returnPath = getSafeReturnPath(req.body.returnTo, fallbackPath);

  if (!ownedPost) {
    setFlash(req, "error", "You can only delete your own posts.");
    return res.redirect(returnPath);
  }

  await db.query(`DELETE FROM comments WHERE post_id = $1`, [postId]);
  await db.query(`DELETE FROM posts WHERE id = $1`, [postId]);
  setFlash(req, "success", "Post deleted.");
  return res.redirect(returnPath);
});

app.post("/comments/:commentId/edit", requireAuth, async (req, res) => {
  const commentId = Number(req.params.commentId);
  const content = req.body.content?.trim();
  const ownedComment = await getOwnedCommentForUser(req.session.user.id, commentId);
  const fallbackPath = ownedComment?.group_slug ? `/groups/${ownedComment.group_slug}` : "/profile";
  const returnPath = getSafeReturnPath(req.body.returnTo, fallbackPath);

  if (!ownedComment) {
    setFlash(req, "error", "You can only edit your own comments.");
    return res.redirect(returnPath);
  }

  if (!content) {
    setFlash(req, "error", "Comment content cannot be empty.");
    return res.redirect(returnPath);
  }

  await db.query(`UPDATE comments SET content = $1 WHERE id = $2`, [content, commentId]);
  setFlash(req, "success", "Comment updated.");
  return res.redirect(returnPath);
});

app.post("/comments/:commentId/delete", requireAuth, async (req, res) => {
  const commentId = Number(req.params.commentId);
  const ownedComment = await getOwnedCommentForUser(req.session.user.id, commentId);
  const fallbackPath = ownedComment?.group_slug ? `/groups/${ownedComment.group_slug}` : "/profile";
  const returnPath = getSafeReturnPath(req.body.returnTo, fallbackPath);

  if (!ownedComment) {
    setFlash(req, "error", "You can only delete your own comments.");
    return res.redirect(returnPath);
  }

  await db.query(`DELETE FROM comments WHERE id = $1`, [commentId]);
  setFlash(req, "success", "Comment deleted.");
  return res.redirect(returnPath);
});

app.get("/groups/:slug", async (req, res) => {
  const group = await getGroupBySlug(req.params.slug);

  if (!group) {
    return res.status(404).render("group-page.ejs", {
      theme: "newpost",
      group: null,
      posts: [],
      isMember: false,
    });
  }

  const [posts, isMember] = await Promise.all([
    getPostsForGroup(group),
    req.session.user ? isGroupMember(req.session.user.id, group.id) : Promise.resolve(false),
  ]);

  const postIds = posts.map((post) => Number(post.id));
  const commentsByPostId = await getCommentsForPostIds(postIds);
  const postsWithComments = posts.map((post) => ({
    ...post,
    comments: commentsByPostId.get(Number(post.id)) || [],
  }));

  const theme = fallbackThemeBySlug[group.slug] || "newpost";
  return res.render("group-page.ejs", { theme, group, posts: postsWithComments, isMember });
});

app.get("/carsblogpage", (req, res) => {
  res.redirect("/groups/cars");
});

app.get("/starwarsblogpage", (req, res) => {
  res.redirect("/groups/star-wars");
});

app.get("/batmanblogpage", (req, res) => {
  res.redirect("/groups/batman");
});

app.get("/techblogpage", (req, res) => {
  res.redirect("/groups/tech");
});

app.post("/submit", requireAuth, async (req, res) => {
  const content = req.body.blogPost?.trim();
  const legacySelection = req.body.Blogs;
  const groupSlugByLegacyValue = {
    Car: "cars",
    Batman: "batman",
    "Star Wars": "star-wars",
    Star_Wars: "star-wars",
    Tech: "tech",
  };
  const groupSlug = groupSlugByLegacyValue[legacySelection] || req.body.groupSlug;

  if (!content || !groupSlug) {
    setFlash(req, "error", "Choose a community and write something before posting.");
    return res.redirect("/newpost");
  }

  const { group: writableGroup, error } = await getWritableGroupForUser(req.session.user.id, groupSlug);
  if (!writableGroup) {
    setFlash(req, "error", error);
    return res.redirect(groupSlug ? `/groups/${groupSlug}` : "/newpost");
  }

  const group = await createPostForGroup({
    userId: req.session.user.id,
    groupSlug,
    content,
  });

  if (!group) {
    setFlash(req, "error", "That community no longer exists.");
    return res.redirect("/newpost");
  }

  setFlash(req, "success", `Your post is live in ${group.name}.`);
  return res.redirect(`/groups/${group.slug}`);
});

app.post("/IsubmitB", requireAuth, async (req, res) => {
  const content = req.body["IndividualBlogPost"]?.trim();
  if (!content) {
    setFlash(req, "error", "Write something before posting.");
    return res.redirect("/groups/batman");
  }

  const { error } = await getWritableGroupForUser(req.session.user.id, "batman");
  if (error) {
    setFlash(req, "error", error);
    return res.redirect("/groups/batman");
  }

  await createPostForGroup({ userId: req.session.user.id, groupSlug: "batman", content });
  setFlash(req, "success", "Your post is live in Batman.");
  return res.redirect("/groups/batman");
});

app.post("/IsubmitC", requireAuth, async (req, res) => {
  const content = req.body["IndividualBlogPost"]?.trim();
  if (!content) {
    setFlash(req, "error", "Write something before posting.");
    return res.redirect("/groups/cars");
  }

  const { error } = await getWritableGroupForUser(req.session.user.id, "cars");
  if (error) {
    setFlash(req, "error", error);
    return res.redirect("/groups/cars");
  }

  await createPostForGroup({ userId: req.session.user.id, groupSlug: "cars", content });
  setFlash(req, "success", "Your post is live in Cars.");
  return res.redirect("/groups/cars");
});

app.post("/IsubmitS", requireAuth, async (req, res) => {
  const content = req.body["IndividualBlogPost"]?.trim();
  if (!content) {
    setFlash(req, "error", "Write something before posting.");
    return res.redirect("/groups/star-wars");
  }

  const { error } = await getWritableGroupForUser(req.session.user.id, "star-wars");
  if (error) {
    setFlash(req, "error", error);
    return res.redirect("/groups/star-wars");
  }

  await createPostForGroup({ userId: req.session.user.id, groupSlug: "star-wars", content });
  setFlash(req, "success", "Your post is live in Star Wars.");
  return res.redirect("/groups/star-wars");
});

app.post("/IsubmitT", requireAuth, async (req, res) => {
  const content = req.body["IndividualBlogPost"]?.trim();
  if (!content) {
    setFlash(req, "error", "Write something before posting.");
    return res.redirect("/groups/tech");
  }

  const { error } = await getWritableGroupForUser(req.session.user.id, "tech");
  if (error) {
    setFlash(req, "error", error);
    return res.redirect("/groups/tech");
  }

  await createPostForGroup({ userId: req.session.user.id, groupSlug: "tech", content });
  setFlash(req, "success", "Your post is live in Technology.");
  return res.redirect("/groups/tech");
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }
}

startServer();
