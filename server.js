const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.cwd());
const port = 8123;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname.endsWith("/")) {
    pathname += "index.html";
  }

  const fullPath = path.normalize(path.join(root, pathname));
  const relativePath = path.relative(root, fullPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }

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
