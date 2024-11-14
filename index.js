import express from "express";
import bodyParser from "body-parser";

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use('/public', express.static('public'));

app.set("view engine", "ejs");
app.engine("ejs", require("ejs").__express);
app.set("views", path.join(__dirname, "./views"));

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/newpost", (req, res) => {
  res.render("newpost.ejs");
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

app.get("/carsblogpage", (req, res) => {
  res.render("carsblogpage.ejs");
});

app.get("/starwarsblogpage", (req, res) => {
  res.render("starwarsblogpage.ejs");
});

app.get("/batmanblogpage", (req, res) => {
  res.render("batmanblogpage.ejs");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
