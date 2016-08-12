var m2mid = require('lwm2m-id'),
	fs = require('fs'),
	clUtils = require('command-node');

var lwm2mServer = require('./lwm2m_server'),
	awsClient = require('./aws_client'),
	webSocket = require('./ws_client'),
	httpServer = require('./http_server'),
	homeStateNew = require('./homeState').stateNew,
	homeState = require('./homeState').state,
	deepCopy = require('./utils').deepCopy,
	getDifferent = require('./utils').getDifferent,
	controlMap;

function registrationHandler(endpoint, lifetime, version, binding, payload, callback)
{
	setTimeout(function () {
		switch(endpoint.slice(0, 6)) {
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
//Handler when a lwm2m client connect.
function unregistrationHandler(endpoint)
{
	deleteEndpoint(endpoint);
}

function embarcFunction(endpoint, payload)
{
	var Oid, i, Rid, 
	stateSend = {};
	/*parser the reg payload*/
	lwm2mServer.registerParser(endpoint, payload, homeStateNew);

	/*observe some resource 
	TODO: read the orgin data*/
	resourceShow(endpoint);
	Oid = m2mid.getOid('temperature').value;
	Rid = m2mid.getRid(Oid, 'sensorValue').value;
	if (homeStateNew[endpoint][Oid]) {
		for (i in homeStateNew[endpoint][Oid]) {
				lwm2mServer.observe(endpoint, Oid, i, Rid, handleObserve(endpoint, Oid, i ,Rid), function () {
			});
		}
	}
	Oid = m2mid.getOid('pushButton').value;
	Rid = m2mid.getRid(Oid, 'dInState').value;
	if (homeStateNew[endpoint][Oid]) {
		for (i in homeStateNew[endpoint][Oid]) {
				lwm2mServer.observe(endpoint, Oid, i, Rid, handleObserve(endpoint, Oid, i ,Rid), function () {
			});
		}
	}
	updateUI();
}

function handleObserve(endpoint, Oid, i, Rid)
{
	function obs(value) {
		stateChange(endpoint, Oid, i, Rid, value);
	}
	return obs;
}

//aws function
function handleDelta(thingName, stateObject)
{
	/*find the change from stateObject and send it to emsk(using lwm2mServer.write()) and send it to aws iot*/
	var homeStateDelta = stateObject.state,
		value, endpoint, Oid, i, Rid;
	for (endpoint in homeStateDelta) {
		for (Oid in homeStateDelta[endpoint]) {
			for (i in homeStateDelta[endpoint][Oid]) {
				for (Rid in homeStateDelta[endpoint][Oid][i]) {
					value = homeStateDelta[endpoint][Oid][i][Rid];
					stateChange(endpoint, Oid, i, Rid, value);
				}
			}
		}
	}
	console.log("\nget a delta:%s\n", JSON.stringify(stateObject, null, 4));
	clUtils.prompt();
}

function stateChange(endpoint, Oid, i, Rid, value)
{
	var stack = [];
	//simulate switch by push button.
	if (Oid == m2mid.getOid("pushButton") && Rid == m2mid.getRid("pushButton", "dInState"))
		value = "~";
	//check map
	var controlMap = JSON.parse(fs.readFileSync('./controlMap.json'));
	stateMap(endpoint, Oid, i, Rid, controlMap);

	function stateMap(endpoint, Oid, i, Rid, controlMap) {
		Oid = Oid.toString();
		i = i.toString();
		Rid = Rid.toString();
		valueChange(endpoint, Oid, i, Rid, value);
		if (!controlMap[endpoint] || !controlMap[endpoint][Oid] ||
			!controlMap[endpoint][Oid][i] ||
			controlMap[endpoint][Oid][i][Rid] === undefined) {
			//no map

		} else {
			//found map
			var mapTarget = controlMap[endpoint][Oid][i][Rid];
			if (typeof(mapTarget[0]) != "object") {
				mapTarget = [mapTarget];
			} 
			for (var key in mapTarget) {
				if (mapTarget[key] == "0" || 
					(endpoint == mapTarget[key][0] && 
					Oid == mapTarget[key][1] && 
					i == mapTarget[key][2] && 
					Rid == mapTarget[key][3])) {
					//self map

				} else {
					//map other resource
					stateMap(mapTarget[key][0], mapTarget[key][1], mapTarget[key][2], mapTarget[key][3], controlMap);
				}
			}
		}
	}

	function valueChange(endpoint, Oid, i, Rid, value) {
		if (!homeStateNew[endpoint] || !homeStateNew[endpoint][Oid] ||
			!homeStateNew[endpoint][Oid][i] ||
			homeStateNew[endpoint][Oid][i][Rid] === undefined) {
			//target resource is not in homeStateNew.
			return;
		}
		//check whether value is legal.
		var newValue = dataTypeCheck(endpoint, Oid, i, Rid, value);
		if (newValue === undefined) {
			return;
		}
		stack.push(1);
		//put updateUI() as callback function to send data to UI(freeboard and AWS).
		lwm2mServer.write(endpoint, Oid, i, Rid, newValue, function () {
			homeStateNew[endpoint][Oid][i][Rid] = newValue;
			stack.pop();
			if (stack.length === 0)
				updateUI();
		});
	}

	function dataTypeCheck(endpoint, Oid, i, Rid, value) {
		var def = m2mid.getRdef(Oid, Rid);
		switch(def.type) {
			case "boolean":
			//"~" is used to simulate the switch by push button.
				if (value == "~") {
					value = !homeStateNew[endpoint][Oid][i][Rid];
				} else if (value == "true" || value == "1" || value == 1 || value === true)
					value = true;
				else if (value == "false" || value == "0" || value === 0 || value === false)
					value = false;
				else {
					console.log("get wrong type data: not bool");
					return ;
				}
				break;
			case "float":
			case "integer":
				value = Number(value);
				if (Number.isNaN(value)) {
					console.log("get wrong type data: not number");
					return ;
				}
				break;
			case "string":
				if (value == "~") {
					value = !(homeStateNew[endpoint][Oid][i][Rid] == "true");
				} 
				value = value.toString();
				break;
			case "opaque":
				
				break;
			default:
				console.log("unknow type");
				break;
		}
		return value;
	}
}
//websocket

function handleWSMessage(message)
{
	if (message.type === 'utf8') {
		var msg = message.utf8Data;
		console.log('Received Message: ' + msg);
		//"{}" means that server order the whole state.
		if (msg == "{}") {
			webSocket.send(homeStateNew);
		} else {
			var stateNew = JSON.parse(msg);
			handleWSReported(stateNew);
		}
	} else {
		console.log("unknow message type");
	}
}

function handleWSReported(stateNew)
{
	for (var key in stateNew) {
		if (key == "desired") {
			handleDelta(null, {state: stateNew[key]});
		} else {
			console.log("Can't recieved reported");
		}
	}
}

function updateUI()
{
	var stateSend = getDifferent(homeStateNew, homeState);
	if (stateSend !== undefined) {
		awsClient.send(stateSend);
		webSocket.send(stateSend);
	}	
}

function deleteEndpoint(endpoint)
{
	if (homeStateNew[endpoint] !== undefined) {
		var stateSend={};
		homeStateNew[endpoint] = undefined;
		homeState = deepCopy(homeStateNew);
		stateSend[endpoint] = null;
		awsClient.send(stateSend);
		webSocket.send(stateSend);
	}
}
//command-node
function listClients(commands)
{
	lwm2mServer.listClients(resourceShow);
}

function resourceShow(endpoint)
{
	if (!homeStateNew[endpoint]) {
		return;
	}
	var show = homeStateNew[endpoint];
	for (var obj in show) {
		console.log('%s: ', m2mid.getOid(obj).key);
		for (var instance in show[obj]) {
			console.log('\t%d:', instance);
			for (var resource in show[obj][instance]) {
				console.log('\t\t%s:\t\t%s', m2mid.getRid(obj, resource).key, show[obj][instance][resource].toString());
			}
		}
	}
}

function write(commands)
{
	var endpoint = commands[0],
		Oid = commands[1],
		i = commands[2],
		Rid = commands[3],
		value = commands[4];
	if (Oid < 20) {
		lwm2mServer.write(endpoint, Oid, i, Rid, value);
	} else {
		stateChange(endpoint, Oid, i, Rid, value);

	}
}

function upload(commands)
{
	fs.readFile(commands[1], 'utf8', function(err, data) {
		if (err)
			console.log('\nLwm2m: ERROR  \tRead firmware filed\n%s', JSON.stringify(error, null, 4));
		else {
			lwm2mServer.write(commands[0], 5, 0, 0, data, function callback(err) {
				if (err) {
					console.log('\nLwm2m: ERROR  \t%s', JSON.stringify(error, null, 4));
					clUtils.prompt();
				}
				else {
					console.log("\nLwm2m: SUCCESS\tFirmware upload successful");
					lwm2mServer.execute(commands[0], 5, 0, 2);
				}
			});
		}
	});
}

function execute(commands)
{
	lwm2mServer.execute(commands[0], commands[1], commands[2], commands[3]);
}

function read(commands)
{
	lwm2mServer.read(commands[0], commands[1], commands[2], commands[3]);
}
function showState(commands)
{
	console.log("\n"+JSON.stringify(homeStateNew));
	console.log('\n\n');
	console.log(JSON.stringify(homeState));
	clUtils.prompt();
}
function cancelObservation(commands)
{
	console.log("in cancel");
}
function observe(commands)
{
	// clUtils.executeCommander(['cancel', 1, 1, 1, 1]);
}
function showMap(commands)
{
	controlMap = JSON.parse(fs.readFileSync('./controlMap.json'));
	console.log(JSON.stringify(controlMap, null, 4));
}
function reboot(commands)
{
	lwm2mServer.execute(commands[0], 3, 0, 4);
	clUtils.prompt();
}
function test1(commands)
{
	homeStateNew = {
		"endpoint1":{
			"3303":{
				"0":{
					"5700": true
				}
			},
			"3311":{
				"0":{
					"5850":true
				}
			}
		},

		"endpoint2":{
			"3303":{
				"0":{
					"5700": true
				}
			},
			"3311":{
				"0":{
					"5850":true
				},
				"1":{
					"5850":true
				}
			}
		},

		"endpoint3":{
			"3303":{
				"0":{
					"5700": true
				}
			}
		},

		"endpoint4":{
			"3303":{
				"0":{
					"5700": true
				}
			},
			"3311":{
				"0":{
					"5850":true
				},
				"1":{
					"5850":true
				}
			}
		},	
		"endpoint5":{
			"3303":{
				"0":{
					"5700": true
				}
			},
			"3311":{
				"0":{
					"5850":true
				},
				"1":{
					"5850":true
				}
			}
		},	
		"endpoint6":{
			"3303":{
				"0":{
					"5700": true
				}
			},
			"3311":{
				"0":{
					"5850":true
				},
				"1":{
					"5850":true
				}
			}
		},	
		"endpoint7":{
			"3303":{
				"0":{
					"5700": true
				}
			},
			"3311":{
				"0":{
					"5850":true
				},
				"1":{
					"5850":true
				}
			}
		},	
		"endpoint8":{
			"3303":{
				"0":{
					"5700": true
				}
			},
			"3311":{
				"0":{
					"5850":true
				},
				"1":{
					"5850":true
				}
			}
		}
	};
	updateUI();
}
function test2(commands) {
	
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
		parameters: ['clientName'],
		description: 'Reboot the client',
		handler: reboot
	},
	'test1': {
		parameters: [],
		description: 'Reboot the client',
		handler: test1
	},
	'test2': {
		parameters: [],
		description: 'Reboot the client',
		handler: test2
	},
	'state': {
		parameters: [],
		description: 'Show current homeStateNew and homeState',
		handler: showState,
	}
};

//main
lwm2mServer.start(registrationHandler, unregistrationHandler);
webSocket.start(handleWSMessage);
awsClient.start(handleDelta);
httpServer.start(80);
clUtils.initialize(commands, 'SmartHome-Server> ');
