var config = require('C:/Users/xinyi/Documents/lwm2m-node-lib/config'),
	lwm2mServer = require('C:/Users/xinyi/Documents/lwm2m-node-lib').server,
	m2mid = require('lwm2m-id'),
	thingShadow = require('aws-iot-device-sdk').thingShadow,
	async = require('async'),
	fs = require('fs'),
	globalServerInfo,
	separator = '\n\n\t';

var homeState = {
	state: {
		reported: {
			DoorLocked: false,
			KitchenLights: false,
			LivingRoomLights: false,
			temperature: 0
		}
	}
};
//lwm2m function
function handleResult(message) {
	return function(error) {
		if (error) {
			console.log('err: '+error);
		} else {
			console.log('\nSuccess: %s\n', message);
		}
	};
}

function lwm2m_start() {
	async.waterfall([
		async.apply(lwm2mServer.start, config.server),
		setHandlers
	], handleResult('Lightweight M2M Server started'));
}

function setHandlers(serverInfo, callback) {
	globalServerInfo = serverInfo;
	lwm2mServer.setHandler(serverInfo, 'registration', registrationHandler);
	lwm2mServer.setHandler(serverInfo, 'unregistration', function (device, callback) {
		console.log('\nDevice unregistration:\n----------------------------\n');
		console.log('Device location: %s', device);
		callback();
	});
	callback();
}

function registrationHandler(endpoint, lifetime, version, binding, payload, callback) {
	setTimeout(function (){
		switch(endpoint){
			case "embARC":
				console.log("embARC connected");
				lwm2mServer.getDevice("embARC", function (num, device){
					embarcFunction(device.id);
				});
				break;
			case "other":
				break;
			default:
				console.log("unknow client name: %s\n", endpoint);
				break;
		}
	}, 1000);
	callback();
}

function embarcFunction(id) {
	var i,
		Oid = m2mid.getOid('temperature').value,
		Rid = m2mid.getRid(Oid, 'sensorValue').value;
	/*observe some resource*/
	lwm2mServer.observe(id , Oid, 0, Rid, obsTemp, function (){
		console.log('observe temerature\n');
	});	
	Oid = m2mid.getOid('pushButton').value,
	Rid = m2mid.getRid(Oid, 'dInState').value;
	for (i = 0; i < 3; i++){
		lwm2mServer.observe(id , Oid, i, Rid, _obsBtn(i), function (){
			console.log('observe button \n');
		});
	}
}

function _obsBtn(i){
	function obsBtn(value){
		console.log("button put %d\n", i);
		switch(i){
			case 0:
				homeState.state.reported.DoorLocked = !homeState.state.reported.DoorLocked;
				var homeStateSend = {
					state: {
						reported: {
							DoorLocked : homeState.state.reported.DoorLocked
						}
					}
				}
				break;
			case 1:
				homeState.state.reported.KitchenLights = !homeState.state.reported.KitchenLights;
				var homeStateSend = {
					state: {
						reported: {
							KitchenLights : homeState.state.reported.KitchenLights
						}
					}
				}
				break;
			case 2:
				homeState.state.reported.LivingRoomLights = !homeState.state.reported.LivingRoomLights;
				var homeStateSend = {
					state: {
						reported: {
							LivingRoomLights : homeState.state.reported.LivingRoomLights
						}
					}
				}
				break;
		}
		genericOperation('update', homeStateSend);
	}
	return obsBtn;
}

function obsTemp(value){
	console.log('temperature is %s\n', value);
	homeState.state.reported.temperature = value;
	var homeStateSend = {
		state: {
			reported: {
				temperature : homeState.state.reported.temperature
			}
		}
	}
	genericOperation('update', homeStateSend);
}
//aws function
const thingShadows = thingShadow({
	keyPath: './cert/privateKey.pem' ,
	certPath: './cert/cert.crt' ,
	caPath: './cert/rootCA.crt' ,
	clientId: 'myNode1',
	region: 'ap-southeast-1',
	// debug: true
});
const operationTimeout = 10000;
const thingName = 'SmartHome';
var currentTimeout = null;
var stack = [];

function aws_start(){
	aws_deviceConnect();
	thingShadows.on('connect', function() {
		console.log('connected to AWS IoT');
	});

	thingShadows.on('close', function() {
		console.log('close');
		thingShadows.unregister(thingName);
	});

	thingShadows.on('reconnect', function() {
		console.log('reconnect');
	});
	thingShadows.on('offline', function() {

		if (currentTimeout !== null) {
			clearTimeout(currentTimeout);
			currentTimeout = null;
		}

		while (stack.length) {
			stack.pop();
		}
		console.log('offline');
	});

	thingShadows.on('status', function(thingName, stat, clientToken, stateObject) {
		handleStatus(thingName, stat, clientToken, stateObject);
	});

	thingShadows.on('timeout', function(thingName, clientToken) {
		handleTimeout(thingName, clientToken);
	});

}

function genericOperation(operation, state) {
	var clientToken = thingShadows[operation](thingName, state);

	if (clientToken === null) {
	 //
	 // The thing shadow operation can't be performed because another one
	 // is pending; if no other operation is pending, reschedule it after an 
	 // interval which is greater than the thing shadow operation timeout.
	 //
	 if (currentTimeout !== null) {
		console.log('operation in progress, scheduling retry...');
		currentTimeout = setTimeout(
			function() {
				genericOperation(operation, state);
			},
			operationTimeout * 2);
	 }
	} else {
	 //
	 // Save the client token so that we know when the operation completes.
	 //
	 stack.push(clientToken);
	}
}

function aws_deviceConnect() {
	thingShadows.register(thingName, {
		ignoreDeltas: false,
		operationTimeout: operationTimeout
	});

}

function handleStatus(thingName, stat, clientToken, stateObject) {
	var expectedClientToken = stack.pop();

	console.log("ok");

}

function handleTimeout(thingName, clientToken) {
	var expectedClientToken = stack.pop();

	if (expectedClientToken === clientToken) {
		console.log('timeout on: ' + thingName);
	} else {
		console.log('(timeout) client token mismtach on: ' + thingName);
	}
}

//main
lwm2m_start();
aws_start();
