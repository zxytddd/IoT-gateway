var config = require('lwm2m-node-lib/config'),
	m2mid = require('lwm2m-id'),
	async = require('async'),
	fs = require('fs'),
	clUtils = require('command-node'),
	homeStateNew = require('./homeState').stateNew,
	homeState = require('./homeState').state,
	deepCopy = require('./deepCopy'),
	btnMap = JSON.parse(fs.readFileSync('./btnMap.json'));

var lwm2m_read = require('./lwm2m_server').read,
	lwm2m_write = require('./lwm2m_server').write,
	lwm2m_start = require('./lwm2m_server').start,
	lwm2m_execute = require('./lwm2m_server').execute,
	lwm2m_observe = require('./lwm2m_server').observe,
	lwm2m_registerParser = require('./lwm2m_server').registerParser,
	lwm2m_listClients = require('./lwm2m_server').listClients,
	aws_start = require('./aws_client').start,
	aws_send = require('./aws_client').send;

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

function embarcFunction(endpoint, payload) {
	var i,
		Oid,
		Rid;
	/*parser the reg payload*/
	lwm2m_registerParser(endpoint, payload, homeStateNew);
	/*observe some resource 
	TODO: read the start data*/
	Oid = m2mid.getOid('temperature').value;
	Rid = m2mid.getRid(Oid, 'sensorValue').value;
	if(homeStateNew.reported[endpoint][Oid]){
		lwm2m_observe(endpoint, Oid, 0, Rid, _obsTemp(0, endpoint), function (){
			console.log('observe temerature');
		});	
	}
	Oid = m2mid.getOid('pushButton').value;
	Rid = m2mid.getRid(Oid, 'dInState').value;
	if(homeStateNew.reported[endpoint][Oid]){
		for (i in homeStateNew.reported[endpoint][Oid]){
			lwm2m_observe(endpoint, Oid, i, Rid, _obsBtn(i, endpoint), function (){
				console.log('observe button');
			});
		}
	}
	aws_send(homeStateNew, homeState);
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
			!homeStateNew.reported[ledEndpoint][Oid][ledi] ||
			homeStateNew.reported[ledEndpoint][Oid][ledi][Rid] == undefined){
			console.log("bad map, ignore it.");
			ledEndpoint = endpoint;
			ledi = i;
		}
		value = !homeState.reported[ledEndpoint][Oid][ledi][Rid];
		value = stateChange(endpoint, Oid, i, Rid, value, [homeStateNew.reported, homeStateNew.desired]);
		if (value != undefined){
			lwm2m_write(ledEndpoint, Oid, ledi, Rid, value);
			aws_send(homeStateNew, homeState);
		}
	}
	return obsBtn;
}

function _obsTemp(i, endpoint){
	function obsTemp(value){
		console.log('temperature is %s\n', value);
		var Oid = m2mid.getOid('temperature').value;
		var Rid = m2mid.getRid('temperature', 'sensorValue').value;
		value = stateChange(endpoint, Oid, i, Rid, value, [homeStateNew.reported]);
		if (value != undefined){
			aws_send(homeStateNew, homeState);
		}
	}
	return obsTemp;
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
	console.log("get a delta:%s\n", JSON.stringify(stateObject));
}

function stateChange(endpoint, Oid, i, Rid, value, state){
	var def = m2mid.getRdef(Oid, Rid),
		key;
	if (def.access == 'R')
		return ;
	switch(def.type){
		case "boolean":
			if(value == "true" || value == "1" || value == 1)
				value = true;
			else if (value == "false" || value == "0" || value == 0)
				value = false;
			else {
				console.log("get wrong type data");
				return ;
			}
			break;
		case "float":
		case "integer":
			value = Number(value);
			if (Number.isNaN(value)){
				console.log("get wrong type data");
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
//command-node
function listClients(commands) {
	lwm2m_listClients(resourceShow);
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
		}
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
	lwm2m_execute(commands[0], commands[1], commands[2], commands[3]);
}

function read(commands){
	lwm2m_read(commands[0], commands[1], commands[2], commands[3]);
}
function shwoState(commands){
	console.log(JSON.stringify(homeStateNew));
	console.log('\n\n');
	console.log(JSON.stringify(homeState));
}
function cancelObservation(commands){
	
}
function observe(commands){
	
}
function reloadMap(commands){
	btnMap = JSON.parse(fs.readFileSync('./btnMap.json')),
	console.log(JSON.stringify(btnMap, null, 4));
}
function reboot(commands){
	lwm2m_execute(commands[0], 3, 0, 4);
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
	},
	'state': {
		parameters: [],
		description: 'show current homeStateNew and homeState',
		handler: shwoState,
	}
};

//main
lwm2m_start(registrationHandler);
aws_start(handleDelta);
clUtils.initialize(commands, 'LWM2M-Server> ');
