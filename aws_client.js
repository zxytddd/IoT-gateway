
var thingShadow = require('aws-iot-device-sdk').thingShadow,
	config = require('./config').aws,
	thingShadows,
	operationTimeout = 10000,
	thingName = 'SmartHome',
	globalAWSFlag = false,
	reconnectTime = 0;
	stack = [];

function handleResult(message, error) {
	if (error == 0) {
		console.log('AWS  : SUCCESS\t%s', message);
	} else if(error == 1) {
		console.log('AWS  : ERROR  \t%s', message);
	} else if(error == undefined){
		console.log('AWS  :        \t%s', message);
	}
}

function start(handleDelta, callback){
	thingShadows = thingShadow(config);
	thingShadows.on('connect', function() {
		registerThing(thingName);
		reconnectTime = 0;
		setTimeout(function (){
			globalAWSFlag = true;
			genericOperation('update', {state:{reported:null,desired:null}});
		},5000);
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
		reconnectTime += 1;
	});

	thingShadows.on('offline', function() {
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

	thingShadows.on('error', function(error) {
		if (error.code != 'ETIMEDOUT')
			console.log('error', error);
		if (reconnectTime == 3)
			thingShadows.end();
	});

	thingShadows.on('delta', handleDelta);
}

function registerThing(thingName) {
	thingShadows.register(thingName, {
		ignoreDeltas: false,
		operationTimeout: operationTimeout
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
		console.log('operation in progress, scheduling retry in 5s...');
		setTimeout(function() {
				genericOperation(operation, state);
			}, 5000);

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
		genericOperation("update", {state: {reported: state, desired: state}});
	} else {
		console.log("aws offline");
	}
}

module.exports.start = start;
module.exports.send = shadowSend;
