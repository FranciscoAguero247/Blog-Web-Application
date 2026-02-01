import express from "express";
import bodyParser from "body-parser";
import ejs from "ejs";
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3000;

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

app.get("/techblogpage", (req, res) => {
  res.render("techblogpage.ejs", { theme: "tech" });
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
});

app.post("/IsubmitB", (req, res) => {
  const IndividualBlogPost = req.body["IndividualBlogPost"];
  res.render("batmanblogpage.ejs", { blogPost: IndividualBlogPost });
});

app.post("/IsubmitC", (req, res) => {
  const IndividualBlogPost = req.body["IndividualBlogPost"];
  res.render("carsblogpage.ejs", { blogPost: IndividualBlogPost });
});

app.post("/IsubmitS", (req, res) => {
  const IndividualBlogPost = req.body["IndividualBlogPost"];
  res.render("starwarsblogpage.ejs", { blogPost: IndividualBlogPost });
});

app.get("/carsblogpage", (req, res) => {
  res.render("carsblogpage.ejs", {theme: "car"});
});

app.get("/starwarsblogpage", (req, res) => {
  res.render("starwarsblogpage.ejs", {theme: "sw"});
});

app.get("/batmanblogpage", (req, res) => {
  res.render("batmanblogpage.ejs", {theme: "batman"});
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
