var config = require('C:/Users/xinyi/Documents/lwm2m-node-lib/config'),
	lwm2mServer = require('C:/Users/xinyi/Documents/lwm2m-node-lib').server,
	m2mid = require('lwm2m-id'),
	thingShadow = require('aws-iot-device-sdk').thingShadow,
	async = require('async'),
	fs = require('fs'),
	clUtils = require('command-node'),
	homeStateNew = require('./homeState').stateNew,
	homeState = require('./homeState').state,
	btnMap = JSON.parse(fs.readFileSync('./btnMap.json')),
	globalServerInfo,
	globalAWSFlag = false;


//lwm2m function
function handleResult(message) {
	return function(error) {
		if (error) {
			console.log('err: '+ JSON.stringify(error));
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

function lwm2m_write(endpoint, Oid, i, Rid, value, callback) {
	var def = m2mid.getRdef(Oid, Rid),
		cb;
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
			case "opaque":
				payload = value;
				break;
			default:
				payload = value.toString();
				break;
		}
		if(payload != null){
			if(callback){
				cb = callback;
			} else {
				cb = handleResult('Value written successfully');
			}
			lwm2mServer.write(device.id, Oid, i, Rid, payload, cb);
		} else {
			console.log("wrong data type");
		}
	});
}

function lwm2m_read(endpoint, Oid, i, Rid, callback) {
	lwm2mServer.getDevice(endpoint, function (num, device){
		var cb;
		if (device == null)
			return;
		if(callback){
			cb = callback;
		} else {
			cb = function (err, res){
					if(err)
						console.log("read err: %s", JSON.stringify(err));
					else
						console.log(res);
				};
		}
		lwm2mServer.read(
			device.id,
			Oid,
			i,
			Rid,
			cb);
	});
}

function registerParser(endpoint, payload){
	//TODO: Add the resource to homeStateNew by different object automaticily.
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
		if(found[key][0] < 15)
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
		if(homeState.reported[endpoint][Oid])
			lwm2mServer.observe(device.id, Oid, 0, Rid, _obsTemp(0, endpoint), function (){
				console.log('observe temerature');
			});	
		Oid = m2mid.getOid('pushButton').value;
		Rid = m2mid.getRid(Oid, 'dInState').value;
		if(homeState.reported[endpoint][Oid])
			for (i in homeState.reported[endpoint][Oid]){
				lwm2mServer.observe(device.id, Oid, i, Rid, _obsBtn(i, endpoint), function (){
					console.log('observe button');
				});
			}
	});
}

function _obsBtn(i, endpoint){
	function obsBtn(value){
		console.log("button put %d\n", i);
		var Oid = m2mid.getOid('lightCtrl').value;
		var Rid = m2mid.getRid('lightCtrl', 'onOff').value;
		var ledEndpoint, ledi;

		btnMap = JSON.parse(fs.readFileSync('./btnMap.json'));
		ledEndpoint = btnMap[endpoint][i][0];
		ledi = btnMap[endpoint][i][1];
		if(!homeStateNew.reported[ledEndpoint] || !homeStateNew.reported[ledEndpoint][Oid] ||
			!homeStateNew.reported[ledEndpoint][Oid][ledi]){
			console.log("bad map, ignore it.");
			ledEndpoint = endpoint;
			ledi = i;
		}
		homeStateNew.reported[ledEndpoint][Oid][ledi][Rid] = !homeState.reported[ledEndpoint][Oid][ledi][Rid];
		homeStateNew.desired[ledEndpoint][Oid][ledi][Rid] = !homeState.reported[ledEndpoint][Oid][ledi][Rid];
		lwm2m_write(ledEndpoint, Oid, ledi, Rid, homeStateNew.reported[ledEndpoint][Oid][ledi][Rid]);
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
		clUtils.initialize(commands, 'LWM2M-Server> ');
		globalAWSFlag = true;
	});

	thingShadows.on('close', function() {
		console.log('close');
		globalAWSFlag = false;
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
					lwm2m_write(endpoint, Oid, i, Rid, homeStateDelta[endpoint][Oid][i][Rid]);
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
	console.log("get status");

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
		if(homeStateSend != undefined){
			console.log("send the state to aws:\n%s", JSON.stringify(homeStateSend, null, 4));
			genericOperation("update", {state: homeStateSend});
		}
}

//command-node
function listClients(commands) {
	lwm2mServer.listDevices(function (error, deviceList) {
		if (error) {
			clUtils.handleError(error);
		} else {
			console.log('\nDevice list:\n----------------------------\n');

			for (var i=0; i < deviceList.length; i++) {
				console.log('-> Device Id "%s"', deviceList[i].id);
				console.log('\n%s\n', JSON.stringify(deviceList[i], null, 4));
				resourceShow(deviceList[i].name);
			}

			clUtils.prompt();
		}
	});
	function resourceShow(endpoint){
		if(!homeStateNew.reported[endpoint]){
			return;
		}
		var show = homeStateNew.reported[endpoint];
		for(obj in show){
			console.log('%s: ', m2mid.getOid(obj).key);
			for(instance in show[obj]){
				console.log('\t%d:', instance);
				for(resource in show[obj][instance]){
					console.log('\t\t%s:\t\t%s', m2mid.getRid(obj, resource).key, show[obj][instance][resource].toString());
				}
			}
		}

	}
}
/*TODO: change payload (command[4]) to different data type
		error check*/
function write(commands){
	commands[4] = commands[4][0] - '0';
	if(globalAWSFlag){
		var callback;
		callback = function (err){
			if (err){
				console.log(err);
			} else {
				console.log("write to lwm2m client success");
				homeStateNew.reported[commands[0]][commands[1]][commands[2]][commands[3]] = commands[4]? true : false;
				homeStateNew.desired[commands[0]][commands[1]][commands[2]][commands[3]] = commands[4]? true : false;
				shadowSend();
			}
		}
		lwm2m_write(commands[0], commands[1], commands[2], commands[3], commands[4], callback);
	} else {
		lwm2m_write(commands[0], commands[1], commands[2], commands[3], commands[4]);
	}
}
function upload(commands) {
	fs.readFile(commands[1], 'utf8', function(err, data){
		if(err)
			console.log(err);
		else{
			function callback(err){
				if(err)
					console.log("upload err: %s", JSON.stringify(err));
				else{
					console.log("firmware upload successful");
					execute([commands[0], 5, 0, 2]);
				}
			}
			lwm2m_write(commands[0], 5, 0, 0, data, callback);
		}
	})
}

function execute(commands) {
	lwm2mServer.getDevice(commands[0], function (num, device){
		if (device == null)
			return;
		lwm2mServer.execute(device.id, commands[1], commands[2], commands[3], null, handleResult('Command executed successfully'));
	});
}

function read(commands){
	lwm2m_read(commands[0], commands[1], commands[2], commands[3]);
}
function observe(commands){
	
}
function cancelObservation(commands){
	
}
function reloadMap(commands){
	btnMap = JSON.parse(fs.readFileSync('./btnMap.json')),
	console.log(JSON.stringify(btnMap, null, 4));
}
function reboot(commands){
	execute([commands[0], 3, 0, 4]);
}
var commands = {
	'list': {
		parameters: [],
		description: '\tList all the devices connected to the server.',
		handler: listClients
	},
	'write': {
		parameters: ['clientName', 'objTypeId', 'objInstanceId', 'resourceId', 'resourceValue'],
		description: '\tWrites the given value to the resource indicated by the URI (in LWTM2M format) in the given' +
			'device.',
		handler: write
	},
	'upload': {
		parameters: ['clientName', 'filePath'],
		description: '\tUploads the file from given filePath to' +
			'device.',
		handler: upload		
	},
	'execute': {
		parameters: ['clientName', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: '\tExecutes the selected resource with the given arguments.',
		handler: execute
	},
	'read': {
		parameters: ['clientName', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: '\tReads the value of the resource indicated by the URI (in LWTM2M format) in the given device.',
		handler: read
	},
	'observe': {
		parameters: ['deviceId', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: '\tStablish an observation over the selected resource.',
		handler: observe
	},
	'cancel': {
		parameters: ['deviceId', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: '\tCancel the observation order for the given resource (defined with a LWTM2M URI) ' +
			'to the given device.',
		handler: cancelObservation
	},
	'map': {
		parameters: [],
		description: 'show the map file',
		handler: reloadMap
	},
	'reboot': {
		parameters: ['deviceId'],
		description: 'reboot the client',
		handler: reboot
	}
};

//main
lwm2m_start();
aws_start();
// clUtils.initialize(commands, 'LWM2M-Server> ');
