var m2mid = require('lwm2m-id'),
	fs = require('fs'),
	clUtils = require('command-node');

var lwm2m_read = require('./lwm2m_server').read,
	lwm2m_write = require('./lwm2m_server').write,
	lwm2m_start = require('./lwm2m_server').start,
	lwm2m_execute = require('./lwm2m_server').execute,
	lwm2m_observe = require('./lwm2m_server').observe,
	lwm2m_registerParser = require('./lwm2m_server').registerParser,
	lwm2m_listClients = require('./lwm2m_server').listClients,
	aws_start = require('./aws_client').start,
	aws_send = require('./aws_client').send,
	ws_start = require('./ws_client').start,
	ws_send = require('./ws_client').send,
	homeStateNew = require('./homeState').stateNew,
	homeState = require('./homeState').state,
	deepCopy = require('./deepCopy'),
	controlMap = JSON.parse(fs.readFileSync('./controlMap.json'));

function registrationHandler(endpoint, lifetime, version, binding, payload, callback) {
	setTimeout(function (){
		switch(endpoint.slice(0, 6)){
			case "embARC":
				console.log("\nLwm2m: SUCCESS\tA new client connected: %s", endpoint);	
				embarcFunction(endpoint, payload);
				break;
			case "other":
				break;
			default:
				console.log("\nLwm2m: ERROR  \tUnknow client name: %s", endpoint);
				break;
		}
		clUtils.prompt();
	}, 1000);
	
	callback();
}

function embarcFunction(endpoint, payload) {
	var Oid,
		i,
		Rid;
	/*parser the reg payload*/
	lwm2m_registerParser(endpoint, payload, homeStateNew);
	/*TODO: generate the map file*/

	/*observe some resource 
	TODO: read the orgin data*/
	resourceShow(endpoint);
	Oid = m2mid.getOid('temperature').value;
	Rid = m2mid.getRid(Oid, 'sensorValue').value;
	if(homeStateNew.reported[endpoint][Oid]){
		for (i in homeStateNew.reported[endpoint][Oid]){
			lwm2m_observe(endpoint, Oid, i, Rid, observeHandle(endpoint, Oid, i ,Rid), function (){
			});
		}
	}
	Oid = m2mid.getOid('pushButton').value;
	Rid = m2mid.getRid(Oid, 'dInState').value;
	if(homeStateNew.reported[endpoint][Oid]){
		for (i in homeStateNew.reported[endpoint][Oid]){
			lwm2m_observe(endpoint, Oid, i, Rid, observeHandle(endpoint, Oid, i ,Rid), function (){
			});
		}
	}
	aws_send(homeStateNew, homeState);
	ws_send(homeStateNew);
}

function observeHandle(endpoint, Oid, i, Rid){
	function obs(value){
		controlMap = JSON.parse(fs.readFileSync('./controlMap.json'));
		if(!controlMap[endpoint] || !controlMap[endpoint][Oid] ||
			!controlMap[endpoint][Oid][i] ||
			controlMap[endpoint][Oid][i][Rid] == undefined){
			stateControl([endpoint, Oid, i ,Rid], value);
		} else {
			stateControl(controlMap[endpoint][Oid][i][Rid], value);
		}
	}
	return obs;
	function stateControl(resource, value){
		var key;
		if(typeof(resource[0]) != "object"){
			resource = [resource];
		} 
		for (key in resource){
			var endpoint = resource[key][0],
				Oid = resource[key][1],
				i = resource[key][2],
				Rid = resource[key][3];
			switch(Oid){
				case m2mid.getOid('lightCtrl').value:
					console.log("\n%s: light %d %s", endpoint, i, value ? "on" : "off");
					value = stateChange(endpoint, Oid, i, Rid, "~", [homeStateNew.reported, homeStateNew.desired]);
					if (value != undefined){
						lwm2m_write(endpoint, Oid, i, Rid, value);
					}
					break;
				case m2mid.getOid('temperature').value:
					console.log('\n%s: temperature %d: %s', endpoint, i, value);
					value = stateChange(endpoint, Oid, i, Rid, value, [homeStateNew.reported]);
					if (value != undefined){

					}
					break;
				case m2mid.getOid('pushButton').value:
					console.log("\npushButton can not been controlled");
					break;
				default:
					break;
			}
		}
		aws_send(homeStateNew, homeState);
		ws_send(homeStateNew);

	}
}
//aws function


function handleDelta(thingName, stateObject){
	/*find the change from stateObject and send it to emsk(using lwm2m_write()) and send it to aws iot*/
	var homeStateDelta = stateObject.state,
		value;
	for(endpoint in homeStateDelta){
		for(Oid in homeStateDelta[endpoint]){
			for(i in homeStateDelta[endpoint][Oid]){
				for(Rid in homeStateDelta[endpoint][Oid][i]){
					value = homeStateDelta[endpoint][Oid][i][Rid];
					value = stateChange(endpoint, Oid, i, Rid, value, [homeStateNew.reported, homeStateNew.desired, homeState.desired]);
					if (value != undefined){
						lwm2m_write(endpoint, Oid, i, Rid, homeStateNew.reported[endpoint][Oid][i][Rid]);
					}
				}
			}
		}
	}
	aws_send(homeStateNew, homeState);
	ws_send(homeStateNew);
	console.log("\nget a delta:%s\n", JSON.stringify(stateObject, null, 4));
	clUtils.prompt();
}

function stateChange(endpoint, Oid, i, Rid, value, state){
	var def = m2mid.getRdef(Oid, Rid),
		key;
	for(key in state){
		if(!state[key][endpoint] || !state[key][endpoint][Oid] ||
			!state[key][endpoint][Oid][i] ||
			state[key][endpoint][Oid][i][Rid] == undefined){
			console.log("\nMap  : ERROR  \t%s %s %d %s is not in homeState", endpoint, m2mid.getOid(Oid).key, i, m2mid.getRid(Oid, Rid).key);
			// console.log("\nMap  : ERROR  \t%s has not connected", endpoint);
			clUtils.prompt();
			return;
		}
	}
	switch(def.type){
		case "boolean":
			if(value == "~"){
				value = !state[0][endpoint][Oid][i][Rid];
			} else if(value == "true" || value == "1" || value == 1 || value == true)
				value = true;
			else if(value == "false" || value == "0" || value == 0 || value == false)
				value = false;
			else {
				console.log("get wrong type data: not bool");
				return ;
			}
			break;
		case "float":
		case "integer":
			value = Number(value);
			if (Number.isNaN(value)){
				console.log("get wrong type data: not number");
				return ;
			}
			break;
		case "string":
			value = value.toString();
			break;
		case "opaque":
			
			break;
		default:
			console.log("unknow type");
			break;
	}
	for(key in state){
		state[key][endpoint][Oid][i][Rid] = value;
	}
	return value;
}
//websocket

function handleWSMessage(message) {
	if (message.type === 'utf8') {
		var msg = message.utf8Data;
		console.log('Received Message: ' + msg);
		if(msg == "{}"){
			ws_send(homeStateNew);
		} else {
			var stateNew = JSON.parse(msg);
			handleWSReported(stateNew);
		}
	} else {
		console.log("unknow message type");
	}
}

function handleWSReported(stateNew){
	var key, endpoint, Oid, i ,Rid, value;
	for(key in stateNew){
		if(key == "desired"){
			for(endpoint in stateNew[key]){
				for(Oid in stateNew[key][endpoint]){
					for(i in stateNew[key][endpoint][Oid]){
						for(Rid in stateNew[key][endpoint][Oid][i]){
							value = stateNew[key][endpoint][Oid][i][Rid];
							value = stateChange(endpoint, Oid, i, Rid, value, [homeStateNew.reported, homeStateNew.desired]);
							if(value != undefined){
								lwm2m_write(endpoint, Oid, i, Rid, value);
							}
						}
					}
				}
			}
		}else{
			console.log("Can't recieved reported");
		}
	}
	aws_send(homeStateNew, homeState);
	ws_send(homeStateNew);

}

//command-node
function listClients(commands) {
	lwm2m_listClients(resourceShow);
}

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

function write(commands){
	var endpoint = commands[0],
		Oid = commands[1],
		i = commands[2],
		Rid = commands[3],
		value = commands[4];
	if(Oid < 20){
		lwm2m_write(endpoint, Oid, i, Rid, value);
	} else {
		value = stateChange(endpoint, Oid, i, Rid, value, [homeStateNew.reported, homeStateNew.desired]);
		if (value != undefined){
			lwm2m_write(endpoint, Oid, i, Rid, value);
			aws_send(homeStateNew, homeState);
			ws_send(homeStateNew);
		}
	}
}

function upload(commands) {
	fs.readFile(commands[1], 'utf8', function(err, data){
		if(err)
			console.log('\nLwm2m: ERROR  \tRead firmware filed\n%s', JSON.stringify(error, null, 4));
		else{
			lwm2m_write(commands[0], 5, 0, 0, data, function callback(err){
				if(err){
					console.log('\nLwm2m: ERROR  \t%s', JSON.stringify(error, null, 4));
					clUtils.prompt();
				}
				else{
					console.log("\nLwm2m: SUCCESS\tFirmware upload successful");
					lwm2m_execute(commands[0], 5, 0, 2);
				}
			});
		}
	})
}

function execute(commands) {
	lwm2m_execute(commands[0], commands[1], commands[2], commands[3]);
}

function read(commands){
	lwm2m_read(commands[0], commands[1], commands[2], commands[3]);
}
function showState(commands){
	console.log("\n"+JSON.stringify(homeStateNew));
	console.log('\n\n');
	console.log(JSON.stringify(homeState));
	clUtils.prompt();
}
function cancelObservation(commands){
	console.log("in cancel");
}
function observe(commands){
	// clUtils.executeCommander(['cancel', 1, 1, 1, 1]);
}
function showMap(commands){
	controlMap = JSON.parse(fs.readFileSync('./controlMap.json')),
	console.log(JSON.stringify(controlMap, null, 4));
}
function reboot(commands){
	lwm2m_execute(commands[0], 3, 0, 4);
	clUtils.prompt();
}
var commands = {
	'list': {
		parameters: [],
		description: 'List all the devices connected to the server.',
		handler: listClients
	},
	'write': {
		parameters: ['clientName', 'objTypeId', 'objInstanceId', 'resourceId', 'resourceValue'],
		description: 'Writes the given value to the resource indicated by the URI (in LWTM2M format) in the given' +
			'device.',
		handler: write
	},
	'upload': {
		parameters: ['clientName', 'filePath'],
		description: 'Uploads the file from given filePath to' +
			'device.',
		handler: upload		
	},
	'execute': {
		parameters: ['clientName', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: 'Executes the selected resource with the given arguments.',
		handler: execute
	},
	'read': {
		parameters: ['clientName', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: 'Reads the value of the resource indicated by the URI (in LWTM2M format) in the given device.',
		handler: read
	},
	'observe': {
		parameters: ['deviceId', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: 'Stablish an observation over the selected resource.',
		handler: observe
	},
	'cancel': {
		parameters: ['deviceId', 'objTypeId', 'objInstanceId', 'resourceId'],
		description: 'Cancel the observation order for the given resource (defined with a LWTM2M URI) ' +
			'to the given device.',
		handler: cancelObservation
	},
	'map': {
		parameters: [],
		description: 'Show the map file',
		handler: showMap
	},
	'reboot': {
		parameters: ['deviceId'],
		description: 'Reboot the client',
		handler: reboot
	},
	'state': {
		parameters: [],
		description: 'Show current homeStateNew and homeState',
		handler: showState,
	}
};

//main
lwm2m_start(registrationHandler);
ws_start(handleWSMessage);
// aws_start(handleDelta);
clUtils.initialize(commands, 'LWM2M-Server> ');
