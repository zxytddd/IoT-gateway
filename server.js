/* ------------------------------------------
LICENSE

 * \version 
 * \date 2016-08-25
 * \author Xinyi Zhao(zxytddd@126.com)
 * \brief	The main funcion of the IoT gateway server, including the maintain of resource model HomeState, 
 			and brief logic of resource mapping.
--------------------------------------------- */
/*Node library 'lwm2m-id' define the all objects and resources ID. We could use its API to get the ID form 
string name or conversely*/
var m2mid = require('lwm2m-id'),
	fs = require('fs'),
/*Node library 'command-node' supplies a command line environment in order to debugging.*/	
	clUtils = require('command-node');

var lwm2mServer = require('./lwm2m_server'),
	awsClient = require('./aws_client'),
	webSocket = require('./ws_client'),
	httpServer = require('./http_server'),
	homeStateNew = require('./homeState').stateNew,
	homeState = require('./homeState').state,
	deepCopy = require('./utils').deepCopy,
	getDifferent = require('./utils').getDifferent,
	controlMap,
	lastChange = [,,,,];
/**
 * \brief	handler function when a new client registering.
 * \param	endpoint	the name of client
 * \param	payload		the resources information of this client.
 */
function registrationHandler(endpoint, lifetime, version, binding, payload, callback)
{
	setTimeout(function () {
		/*check the tpye of clients*/
		switch(endpoint.slice(0, 6)) {
			case "embARC":
				console.log("Lwm2m: SUCCESS\tA new client connected: %s", endpoint);	
				embarcFunction(endpoint, payload);
				break;
			case "other":
				break;
			default:
				console.log("Lwm2m: ERROR  \tUnknow client name: %s", endpoint);
				break;
		}
		clUtils.prompt();
	}, 1000);
	callback();
}
/**
 * \brief	handler function when a client unregister.
 * \param	endpoint	The name of client
 */
function unregistrationHandler(endpoint)
{
	deleteEndpoint(endpoint);
}
/**
 * \brief	parser the clients' resources, add them to the HomeState, and observe the resources.
 */
function embarcFunction(endpoint, payload)
{
	var Oid, i, Rid, 
	stateSend = {};
	/*parser the reg payload*/
	lwm2mServer.registerParser(endpoint, payload, homeStateNew);

	/*observe some resource and set the callback function.
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
/**
 * \brief	return the handle function of observe.
 */
function handleObserve(endpoint, Oid, i, Rid)
{
	function obs(value) {
		stateChange(endpoint, Oid, i, Rid, value);
	}
	return obs;
}

/**
 * \brief	change the HomeState by the delta message received from UI.
 */
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
	console.log("get a delta:%s\n", JSON.stringify(stateObject, null, 4));
	clUtils.prompt();
}
/**
 * \brief	change the HomeState, and its mapping resource.
  * \param	value		new value of this resource.
 */
function stateChange(endpoint, Oid, i, Rid, value)
{
	var stack = [],
		time = new Date();
	time = time.getTime();
	/*simulate switch by push button.*/
	if (Oid == m2mid.getOid("pushButton") && Rid == m2mid.getRid("pushButton", "dInState")){
		value = "~";
	}
	/*if get the same change requirement in 300ms, ignore it.*/
	if (endpoint === lastChange[0] && Oid === lastChange[1] && i === lastChange[2] &&
		Rid === lastChange[3] && value === lastChange[4] && time - lastChange[5] < 300){
		return;
	}
	lastChange = [endpoint, Oid, i, Rid, value, time];
	//check map
	var controlMap = JSON.parse(fs.readFileSync('./controlMap.json'));
	resourcesMap(endpoint, Oid, i, Rid, controlMap);
	/**
	 * \brief	map the resource by controlMap.
	 */
	function resourcesMap(endpoint, Oid, i, Rid, controlMap) {
		Oid = Oid.toString();
		i = i.toString();
		Rid = Rid.toString();
		/*change the value of source resource.*/
		valueChange(endpoint, Oid, i, Rid, value);
		/*check whether source resource has been mapped.*/
		if (!controlMap[endpoint] || !controlMap[endpoint][Oid] ||
			!controlMap[endpoint][Oid][i] ||
			controlMap[endpoint][Oid][i][Rid] === undefined) {
			/*no map, stop mapping*/

		} else {
			/*found map*/
			var mapTarget = controlMap[endpoint][Oid][i][Rid];
			/*the format of map target could be [endpoint, Oid, i, Rid] or [[endpoint, Oid, i, Rid],[...]]
			normalize them*/
			if (typeof(mapTarget[0]) != "object") {
				mapTarget = [mapTarget];
			} 
			/*change each map target*/
			for (var key in mapTarget) {
				if (mapTarget[key] == "0" || 
					(endpoint == mapTarget[key][0] && 
					Oid == mapTarget[key][1] && 
					i == mapTarget[key][2] && 
					Rid == mapTarget[key][3])) {
					/*if the map target is itself, ignore it.*/

				} else {
					/*change the target resource, this resource also might be mapped.*/
					resourcesMap(mapTarget[key][0], mapTarget[key][1], mapTarget[key][2], mapTarget[key][3], controlMap);
				}
			}
		}
	}
	/**
	 * \brief	change the value of HomeState and update the UI.
	 */
	function valueChange(endpoint, Oid, i, Rid, value) {
		if (!homeStateNew[endpoint] || !homeStateNew[endpoint][Oid] ||
			!homeStateNew[endpoint][Oid][i] ||
			homeStateNew[endpoint][Oid][i][Rid] === undefined) {
			/*target resource is not in homeState.*/
			return;
		}
		/*check whether value is legal.*/
		var newValue = dataTypeCheck(endpoint, Oid, i, Rid, value);
		if (newValue === undefined) {
			return;
		}
		/*using a stack here to check whether all resources has been wrote to endpoints.*/
		stack.push(1);
		lwm2mServer.write(endpoint, Oid, i, Rid, newValue, function () {
			homeStateNew[endpoint][Oid][i][Rid] = newValue;
			/*set a 200ms timeout to wait all resources writing command has been sent.*/
			setTimeout(function (){
				stack.pop();
				/*if the stack is empty, all resources has been wroten to the endpoints, 
				so the UI should be updated.*/
				if (stack.length === 0){
					updateUI();
				}
			}, 200);
		});
	}
	/**
	 * \brief	check legality of the value of this resource, and change the value to an appropriate format. 
	 * \retval	undefine	the value is illegal.
	 * \retval	value		the lagal value
	 */
	function dataTypeCheck(endpoint, Oid, i, Rid, value) {
		var def = m2mid.getRdef(Oid, Rid);
		switch(def.type) {
			case "boolean":
			//"~" is used to simulate the switch by push button.
				if (value == "~") {
					value = !homeStateNew[endpoint][Oid][i][Rid];
				} else if (value == "true" || value == "1" || value == 1 || value === true){
					value = true;
				} else if (value == "false" || value == "0" || value === 0 || value === false){
					value = false;
				} else {
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
					value = (homeStateNew[endpoint][Oid][i][Rid] !== "true");
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
/**
 * \brief	handle function when get the message from web socket.
 */
function handleWSMessage(message)
{
	if (message.type === 'utf8') {
		var msg = message.utf8Data;
		console.log("Received Message: " + msg);
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
/**
 * \brief	handle the new state received from web socket.
 */
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
/**
 * \brief	find the different between new HomeState the old, and send the different state to UI, including the 
 			AWS and web socket.
 */
function updateUI()
{
	var stateSend = getDifferent(homeStateNew, homeState);
	if (stateSend !== undefined) {
		awsClient.send(stateSend);
		webSocket.send(stateSend);
	}	
}
/**
 * \brief	delete the endpoint from HomeState and update the UI.
 */
function deleteEndpoint(endpoint)
{
	if (homeStateNew[endpoint] !== undefined) {
		var stateSend={};
		/*delete the endpoint from HomeState*/
		homeStateNew[endpoint] = undefined;
		homeState = deepCopy(homeStateNew);
		/*send the 'null' to inform the UI that this endpoint has been deleted.*/
		stateSend[endpoint] = null;
		awsClient.send(stateSend);
		webSocket.send(stateSend);
	}
}
/*here's some command to debug*/
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
		console.log("%s: ", m2mid.getOid(obj).key);
		for (var instance in show[obj]) {
			console.log("\t%d:", instance);
			for (var resource in show[obj][instance]) {
				console.log("\t\t%s:\t\t%s", m2mid.getRid(obj, resource).key, show[obj][instance][resource].toString());
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
	fs.readFile(commands[1], "utf8", function(err, data) {
		if (err){
			console.log("Lwm2m: ERROR  \tRead firmware filed\n%s", JSON.stringify(err, null, 4));
		}
		else {
			lwm2mServer.write(commands[0], 5, 0, 0, data, function callback(err) {
				if (err) {
					console.log("Lwm2m: ERROR  \t%s", JSON.stringify(err, null, 4));
					clUtils.prompt();
				}
				else {
					console.log("Lwm2m: SUCCESS\tFirmware upload successful");
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
	console.log(JSON.stringify(homeStateNew));
	console.log("\n");
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
		"embARC_kitchen":{
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

		"embARC_door":{
			"3311":{
				"0":{
					"5850":true
				}
			}
		}
	};
	updateUI();
}
function test2(commands) {
	deleteEndpoint("embARC_door");
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
/*start the lwm2m server, web socket server, http server, command line and connect to AWS IoT cloud.*/
lwm2mServer.start(registrationHandler, unregistrationHandler);
webSocket.start(handleWSMessage);
awsClient.start(handleDelta);
httpServer.start(80);
clUtils.initialize(commands, 'SmartHome-Server> ');
