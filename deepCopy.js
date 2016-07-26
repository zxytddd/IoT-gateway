function deepCopy(input){
	var output = {};
	var empty,
		key,
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

module.exports = deepCopy;