
var thingShadow = require('aws-iot-device-sdk').thingShadow,
	deepCopy = require('./deepCopy'),
	config = require('./config').aws,
	thingShadows,
	operationTimeout = 10000,
	thingName = 'SmartHome',
	currentTimeout = null,
	stack = [];

function start(handleDelta, callback){
	thingShadows = thingShadow(config);
	aws_deviceConnect();
	thingShadows.on('connect', function() {
		console.log('connected to AWS IoT');
		// genericOperation('update', {state:{reported:null,desired:null}});
		globalAWSFlag = true;
		// callback();
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

function aws_deviceConnect() {
	thingShadows.register(thingName, {
		ignoreDeltas: false,
		operationTimeout: operationTimeout
	});

}

function genObjSend(stateNew, state){
	var stateSend = {};
	var empty,
		key,
		del = true;
	for(key in stateNew){
		if (typeof(stateNew[key]) == "object"){
			if(state[key] == undefined){
				state[key] = deepCopy(stateNew[key]);
				stateSend[key] = deepCopy(stateNew[key]);
			}else{
				stateSend[key] = genObjSend(stateNew[key], state[key]);
			}
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

function shadowSend(homeStateNew, homeState){
	/*generate homeStateSend from homeStateNew and homeState in different*/
		var homeStateSend = {};
		homeStateSend = genObjSend(homeStateNew, homeState);
		if(homeStateSend != undefined){
			if(globalAWSFlag){
				console.log("send the state to aws:\n%s", JSON.stringify(homeStateSend, null, 4));
				genericOperation("update", {state: homeStateSend});
			} else {
				console.log("aws offline");
			}
		}
}

module.exports.start = start;
module.exports.send = shadowSend;
