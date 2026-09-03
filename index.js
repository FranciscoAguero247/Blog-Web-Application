import express from "express";
import bodyParser from "body-parser";
import ejs from "ejs";
import * as path from 'path';
import { fileURLToPath } from 'url';
import PG from "pg";
import dotenv from "dotenv";

dotenv.config();

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
      joined_at TIMESTAMP DEFAULT NOW()
    );
  `;

  await db.query(schemaSql);
  console.log("Database schema verified");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(bodyParser.urlencoded({ extended: false }));
app.use('/public', express.static('public'));

app.set("view engine", "ejs");
app.engine("ejs", ejs.__express);
app.set("views", path.join(__dirname, "./views"));
app.use(express.static(__dirname + "/public/"));

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/newpost", (req, res) => {
  res.render("newpost.ejs", { theme : "newpost"});
});

app.get("/about", (req, res) => {
  res.render("about.ejs", { theme: "newpost" });
});

app.post("/submit", (req, res) => {
  const post = req.body["blogPost"];
  const selectedBlog = req.body.Blogs;
  if(selectedBlog === "Car"){
    res.render("carsblogpage.ejs", { post: post });
  }
  if(selectedBlog === "Batman"){
    res.render("batmanblogpage.ejs", { post: post });
  }
  if(selectedBlog === "Star Wars"){
    res.render("starwarsblogpage.ejs", { post: post });
  }
  if(selectedBlog === "Tech"){
    res.render("techblogpage.ejs", { post: post });
  }
});

app.post("/IsubmitB", async(req, res) => {
  const content = req.body["IndividualBlogPost"];
  try {
    await db.query(
        "INSERT INTO posts (content, category) VALUES ($1, $2)",
        [content, 'Batman']
    );
    res.redirect("/batmanblogpage");
  } catch (err) {
    console.error(err);
    res.redirect("/batmanblogpage");
  }
});

app.post("/IsubmitC", async(req, res) => {
  const content = req.body["IndividualBlogPost"];
  try {
    await db.query(
        "INSERT INTO posts (content, category) VALUES ($1, $2)",
        [content, 'Car']
    );
    res.redirect("/carsblogpage");
  } catch (err) {
    console.error(err);
    res.redirect("/carsblogpage");
  }
});

app.post("/IsubmitS", async(req, res) => {
  const content = req.body["IndividualBlogPost"];
  try {
    await db.query(
        "INSERT INTO posts (content, category) VALUES ($1, $2)",
        [content, 'Star Wars']
    );
    res.redirect("/starwarsblogpage");
  } catch (err) {
    console.error(err);
    res.redirect("/starwarsblogpage");
  }
});

app.post("/IsubmitT", async (req, res) => {
  const content = req.body["IndividualBlogPost"];
  try {
    await db.query(
        "INSERT INTO posts (content, category) VALUES ($1, $2)",
        [content, 'Tech']
    );
    res.redirect("/techblogpage"); 
  } catch (err) {
    console.error(err);
    res.redirect("/techblogpage");
  }
});

app.get("/carsblogpage", async(req, res) => {
  try {
    const result = await db.query(
        "SELECT * FROM posts WHERE category = 'Car' ORDER BY created_at DESC"
    );
    res.render("carsblogpage.ejs", { 
        theme: "car", 
        posts: result.rows 
    });
  } catch (err) {
    console.error(err);
    res.render("carsblogpage.ejs", { theme: "car", posts: [] });
  }
});

app.get("/starwarsblogpage", async(req, res) => {
  try {
    const result = await db.query(
        "SELECT * FROM posts WHERE category = 'Star Wars' ORDER BY created_at DESC"
    );
    res.render("starwarsblogpage.ejs", { 
        theme: "sw", 
        posts: result.rows 
    });
  } catch (err) {
    console.error(err);
    res.render("starwarsblogpage.ejs", { theme: "sw", posts: [] });
  }
});

app.get("/batmanblogpage", async(req, res) => {
  try {
    const result = await db.query(
        "SELECT * FROM posts WHERE category = 'Batman' ORDER BY created_at DESC"
    );
    res.render("batmanblogpage.ejs", { 
        theme: "batman", 
        posts: result.rows 
    });
  } catch (err) {
    console.error(err);
    res.render("batmanblogpage.ejs", { theme: "batman", posts: [] });
  }
});

app.get("/techblogpage", async (req, res) => {
  try {
    const result = await db.query(
        "SELECT * FROM posts WHERE category = 'Tech' ORDER BY created_at DESC"
    );
    res.render("techblogpage.ejs", { 
        theme: "tech", 
        posts: result.rows // Passing ALL posts from DB
    });
  } catch (err) {
    console.error(err);
    res.render("techblogpage.ejs", { theme: "tech", posts: [] });
  }
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
