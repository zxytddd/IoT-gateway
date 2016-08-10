var WebSocketServer = require('websocket').server,
	http = require('http');
var clients = [],
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
		var newClient = request.accept(null, request.origin);
		clients.push(newClient);
		console.log(' A new client accepted.');
		newClient.on('message', handleMessage);
		newClient.on('close', function(reasonCode, description) {
			console.log(' Peer ' + newClient.remoteAddress + ' disconnected.');
			for(var key in clients){
				if (clients[key] == newClient){
					clients.slice(0, key).concat(clients.slice(key + 1));
					break;
				}
			}
		});
	});
}

function send(state){
	for(var key in clients){
		clients[key].sendUTF(JSON.stringify({state: {reported: state, desired: state}}));
	}
}

module.exports.start = start;
module.exports.send = send;
