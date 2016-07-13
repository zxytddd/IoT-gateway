var config = require('C:/Users/xinyi/Documents/lwm2m-node-lib/config'),
	lwm2mServer = require('C:/Users/xinyi/Documents/lwm2m-node-lib').server,
	m2mid = require('lwm2m-id'),
	thingShadow = require('aws-iot-device-sdk').thingShadow,
	async = require('async'),
	fs = require('fs'),
	homeStateNew = require('./homeState').stateNew,
	homeState = require('./homeState').state,
	globalServerInfo,
	separator = '\n\n\t';


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
		switch(endpoint.slice(0, 6)){
			case "embARC":
				console.log("%s connected", endpoint);	
				embarcFunction(endpoint, payload);
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

function write(endpoint, Oid, i, Rid, value) {
	var def = m2mid.getRdef(Oid, Rid);
	if (def.access == 'R')
		return ;
	lwm2mServer.getDevice(endpoint, function (num, device){
		if (device == null)
			return;
		var payload;
		switch(def.type){
			case "boolean":
				payload = value ? '1' : '0';
				break;
			case "float":
				payload = value.toString();
				break;
			default:
				payload = value.toString();
				break;
		}
		if(payload != null)
	    	lwm2mServer.write(device.id, Oid, i, Rid, payload, handleResult('Value written successfully'));
	});
}

// function read(commands) {
//     	lwm2mServer.getDevice(commands[0], function (num, device){
// 		if (device == null)
// 			return;
// 	    lwm2mServer.read(
// 	        device.id,
// 	        commands[1],
// 	        commands[2],
// 	        commands[3],
// 	        function (err, res){
// 	        	if(err)
// 	        		return;
// 	        	else
// 	        		return res;
// 	        });
// 	});
// }

function registerParser(endpoint, payload){
	var out = {},
		found = payload.split('>,<'),
		reported = {}, 
		desired={};
	found[0] = found[0].slice(1);
	found[found.length - 1] = found[found.length - 1].slice(0, found[found.length - 1].length - 1);
	for(key in found){
		found[key] = found[key].slice(1);
		found[key] = found[key].split('/');
	}
	for(key in found){
		if(found[key][0] < 1000)
			continue;
		if(!out[found[key][0]])
			out[found[key][0]]={};
		if(found[key][1])
			out[found[key][0]][found[key][1]]={};
	}
	reported = deepCopy(out);
	desired = deepCopy(out);
	for(obj in reported){
		for(instance in reported[obj]){
			switch(obj){
				case "3303":
					reported[obj][instance][5700] = false;
					delete desired[obj];
					break;
				case "3311":
					reported[obj][instance][5850] = false;
					desired[obj][instance][5850] = false;
					break;
				case "3347":
					reported[obj][instance][5500] = false;
					desired[obj][instance][5500] = false;
					break;
				default:
					break;
			}
		}
	}
	homeStateNew.reported[endpoint] = deepCopy(reported);
	homeStateNew.desired[endpoint] = deepCopy(desired);
	homeState.reported[endpoint] = deepCopy(reported);
	homeState.desired[endpoint] = deepCopy(desired);
	function deepCopy(input){
		var output = {};
		var empty,
			del = true;
		for(key in input){
			if (typeof(input[key]) == "object"){
				output[key] = deepCopy(input[key]);
			} else {
				output[key] = input[key];
			}
		}

		return output;
	}
}

function embarcFunction(endpoint, payload) {
	var i,
		Oid,
		Rid;
	/*parser the reg payload*/
	registerParser(endpoint, payload);
	/*observe some resource*/
	lwm2mServer.getDevice(endpoint, function (num, device){
		Oid = m2mid.getOid('temperature').value;
		Rid = m2mid.getRid(Oid, 'sensorValue').value;
		if(homeState.reported[endpoint][Oid]);
			lwm2mServer.observe(device.id, Oid, 0, Rid, _obsTemp(0, 'embARC'), function (){
				console.log('observe temerature\n');
			});	
		Oid = m2mid.getOid('pushButton').value;
		Rid = m2mid.getRid(Oid, 'dInState').value;
		if(homeState.reported[endpoint][Oid]);
			for (i in homeState.reported[endpoint][Oid]){
				lwm2mServer.observe(device.id, Oid, i, Rid, _obsBtn(i, 'embARC'), function (){
					console.log('observe button \n');
				});
			}
	});
}

function _obsBtn(i, endpoint){
	function obsBtn(value){
		console.log("button put %d\n", i);
		var Oid = m2mid.getOid('lightCtrl').value;
		var Rid = m2mid.getRid('lightCtrl', 'onOff').value;
		homeStateNew.reported[endpoint][Oid][i][Rid] = !homeState.reported[endpoint][Oid][i][Rid];
		homeStateNew.desired[endpoint][Oid][i][Rid] = !homeState.reported[endpoint][Oid][i][Rid];
		write(endpoint, Oid, i, Rid, homeStateNew.reported[endpoint][Oid][i][Rid]);
		shadowSend();
	}
	return obsBtn;
}
function _obsTemp(i, endpoint){
	function obsTemp(value){
		console.log('temperature is %s\n', value);
		var Oid = m2mid.getOid('temperature').value;
		var Rid = m2mid.getRid('temperature', 'sensorValue').value;
		homeStateNew.reported[endpoint][Oid][i][Rid] = value;
		shadowSend();
	}
	return obsTemp;
}
//aws function
var thingShadows;
const operationTimeout = 10000;
const thingName = 'SmartHome';
var currentTimeout = null;
var stack = [];

function aws_start(){
	thingShadows = thingShadow({
		keyPath: './cert/privateKey.pem' ,
		certPath: './cert/cert.crt' ,
		caPath: './cert/rootCA.crt' ,
		clientId: 'myNode1',
		region: 'ap-southeast-1',
		// debug: true
	});
	aws_deviceConnect();
	thingShadows.on('connect', function() {
		console.log('connected to AWS IoT');
		// genericOperation('update', {state:{reported:null,desired:null}});
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

	thingShadows.on('delta', handleDelta);
}

function handleDelta(thingName, stateObject){
	/*find the change from stateObject and send it to emsk(using lwm2m_write()) and send it to aws iot*/
	var homeStateDelta = stateObject.state;
	for(endpoint in homeStateDelta){
		for(Oid in homeStateDelta[endpoint]){
			for(i in homeStateDelta[endpoint][Oid]){
				for(Rid in homeStateDelta[endpoint][Oid][i]){
					write(endpoint, Oid, i, Rid, homeStateDelta[endpoint][Oid][i][Rid]);
					homeStateNew.reported[endpoint][Oid][i][Rid] = homeStateDelta[endpoint][Oid][i][Rid];
					shadowSend();
				}
			}
		}
	}
	console.log("get a delta:%s\n", JSON.stringify(stateObject));
}

function genObjSend(stateNew, state){
	var stateSend = {};
	var empty,
		del = true;
	for(key in stateNew){
		if (typeof(stateNew[key]) == "object"){
			stateSend[key] = genObjSend(stateNew[key], state[key]);
		} else {
			if(stateNew[key] != state[key]){
				stateSend[key] = stateNew[key];
				state[key] = stateNew[key];
			} else{
				return ;
			}
		}
	}
	for (key in stateSend){
		if(stateSend[key] != undefined)
		del = false;		
	}
	if(del)
		return ;
	return stateSend;
	
}

function genericOperation(operation, state) {
	var clientToken = thingShadows[operation](thingName, state);

	if (clientToken === null) {
	 //
	 // The thing shadow operation can't be performed because another one
	 // is pending; if no other operation is pending, reschedule it after an 
	 // interval which is greater than the thing shadow operation timeout.
	 //
		console.log('operation in progress, scheduling retry in 2s...');
		setTimeout(function() {
				genericOperation(operation, state);
			}, 2000);

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
	console.log("get status:%s\n", JSON.stringify(stateObject));

}

function handleTimeout(thingName, clientToken) {
	var expectedClientToken = stack.pop();

	if (expectedClientToken === clientToken) {
		console.log('timeout on: ' + thingName);
	} else {
		console.log('(timeout) client token mismtach on: ' + thingName);
	}
}

function shadowSend(){
	/*generate homeStateSend from homeStateNew and homeState in different*/
		var homeStateSend = {};
		homeStateSend = genObjSend(homeStateNew, homeState);
		if(homeStateSend != undefined)
			genericOperation("update", {state: homeStateSend});
}

//main
lwm2m_start();
aws_start();
