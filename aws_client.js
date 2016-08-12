
var thingShadow = require('aws-iot-device-sdk').thingShadow,
	config = require('./config').aws,
	thingShadows,
	operationTimeout = 10000,
	thingName = 'SmartHome',
	globalAWSFlag = false,
	handleResult = function (){},
	stack = [];

function start(handleDelta, callback)
{
	thingShadows = thingShadow(config);
	thingShadows.on('connect', function() {
		registerThing(thingName);
		setTimeout(function () {
			globalAWSFlag = true;
			genericOperation('update', {state:{reported:null,desired:null}});
		},5000);
		handleResult = function (message, error) {
			if (error === 0) {
				console.log('AWS  : SUCCESS\t%s', message);
			} else if(error == 1) {
				console.log('AWS  : ERROR  \t%s', message);
			} else if(error === undefined){
				console.log('AWS  :        \t%s', message);
			}
		}
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
			handleResult(error, 1);
	});

	thingShadows.on('delta', handleDelta);
}

function registerThing(thingName)
{
	thingShadows.register(thingName, {
		ignoreDeltas: false,
		operationTimeout: operationTimeout,
		enableVersioning: false,

	});

}

function genericOperation(operation, state)
{
	var clientToken = thingShadows[operation](thingName, state);
	if (clientToken === null) {
		console.log('operation in progress, scheduling retry in 5s...');
		setTimeout(function() {
				genericOperation(operation, state);
			}, 5000);
	} else {
		stack.push(clientToken);
	}
}

function shadowSend(state)
{
	if (globalAWSFlag) {
		console.log("send the state to aws:\n%s", JSON.stringify(state, null, 4));
		genericOperation("update", {state: {reported: state, desired: state}});
	} else {
		handleResult("aws offline", 1);
	}
}

module.exports.start = start;
module.exports.send = shadowSend;
