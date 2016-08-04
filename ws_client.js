var WebSocketServer = require('websocket').server,
	http = require('http');
var connection,
	server,
	wsServer;

function start(handleMessage){
	server = http.createServer(function(request, response) {
		console.log(' Received request for ' + request.url);
		response.writeHead(404);
		response.end();
	});
	server.listen(3001, function() {
		console.log(' Server is listening on port 3001');
	});
	wsServer = new WebSocketServer({
		httpServer: server,

		autoAcceptConnections: false
	});

	wsServer.on('request', function(request) {
		connection = request.accept(null, request.origin);
		console.log(' Connection accepted.');
		connection.on('message', handleMessage);
		connection.on('close', function(reasonCode, description) {
			console.log(' Peer ' + connection.remoteAddress + ' disconnected.');
			connection = 0;
		});
	});
}

function send(state){
	if(connection){
		connection.sendUTF(JSON.stringify(state));
	} else {
		console.log("webSocket off line");
	}
}

module.exports.start = start;
module.exports.send = send;
