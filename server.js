const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const port = 8123;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

http.createServer((req, res) => {
  const pathname = req.url === "/" ? "/index.html" : req.url;
  const fullPath = path.join(root, pathname);

  fs.readFile(fullPath, (error, data) => {
    if (error) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    res.setHeader("Content-Type", contentTypes[path.extname(fullPath)] || "text/plain; charset=utf-8");
    res.end(data);
  });
}).listen(port, () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}`);
});
