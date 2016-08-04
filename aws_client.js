
var thingShadow = require('aws-iot-device-sdk').thingShadow,
	clUtils = require('command-node'),
	config = require('./config').aws,
	thingShadows,
	operationTimeout = 10000,
	thingName = 'SmartHome',
	currentTimeout = null,
	globalAWSFlag = false,
	stack = [];

function handleResult(message, error) {
	if (error == 0) {
		console.log('\nAWS  : SUCCESS\t%s', message);
	} else if(error == 1) {
		console.log('\nAWS  : ERROR  \t%s', message);
	} else if(error == undefined){
		console.log('\nAWS  :        \t%s', message);
	}
	clUtils.prompt();
}

function start(handleDelta, callback){
	thingShadows = thingShadow(config);
	aws_deviceConnect();
	thingShadows.on('connect', function() {
		// genericOperation('update', {state:{reported:null,desired:null}});
		globalAWSFlag = true;
		if(callback)
			callback();
		else
			handleResult('connected', 0);
	});

	thingShadows.on('close', function() {
		globalAWSFlag = false;
		thingShadows.unregister(thingName);
		handleResult('close');
	});

	thingShadows.on('reconnect', function() {
		handleResult('reconnecting');
	});

	thingShadows.on('offline', function() {

		if (currentTimeout !== null) {
			clearTimeout(currentTimeout);
			currentTimeout = null;
		}

		while (stack.length) {
			stack.pop();
		}
		handleResult('offline');
	});

	thingShadows.on('status', function(thingName, stat, clientToken, stateObject) {
		var expectedClientToken = stack.pop();
		handleResult('get status', 0);
	});

	thingShadows.on('timeout', function(thingName, clientToken) {
		var expectedClientToken = stack.pop();
		if (expectedClientToken === clientToken) {
			handleResult('timeout', 1);
		} else {
			handleResult('client token mismtach', 1);
		}
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

function shadowSend(state){

	if(globalAWSFlag){
		console.log("send the state to aws:\n%s", JSON.stringify(state, null, 4));
		genericOperation("update", {state: state});
	} else {
		console.log("aws offline");
	}
}

module.exports.start = start;
module.exports.send = shadowSend;
