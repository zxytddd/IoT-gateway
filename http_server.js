var http = require('http');
var url=require('url');
var fs=require('fs');
var mine=require('./type').types;
var path=require('path');

var server = http.createServer(function (request, response)
{
	var pathname = url.parse(request.url).pathname;
	if (pathname.slice(-1) === "/") {
		pathname = pathname + "index.html";
	}
	var realPath = path.join("./freeboard", pathname);
	//console.log(realPath);
	var ext = path.extname(realPath);
	ext = ext ? ext.slice(1) : 'unknown';
	fs.exists(realPath, function (exists) {
		if (!exists) {
			response.writeHead(404, {
				'Content-Type': 'text/plain'
			});

			response.write("This request URL " + pathname + " was not found on this server.");
			response.end();
		} else {
			fs.readFile(realPath, "binary", function (err, file) {
				if (err) {
					response.writeHead(500, {
						'Content-Type': 'text/plain'
					});
					response.end(err);
				} else {
					var contentType = mine[ext] || "text/plain";
					response.writeHead(200, {
						'Content-Type': contentType
					});
					response.write(file, "binary");
					response.end();
				}
			});
		}
	});
});
function start(port)
{
	server.listen(port);
	console.log("Http server runing at port: " + port + ".");
}
module.exports.start = start;
