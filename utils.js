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

function getDifferent(obj1, obj2){
	var objDifferent = {};
	var empty,
		key,
		del = true;
	for(key in obj1){
		if (typeof(obj1[key]) == "object"){
			if(obj2[key] == undefined){
				obj2[key] = deepCopy(obj1[key]);
				objDifferent[key] = deepCopy(obj1[key]);
			}else{
				objDifferent[key] = getDifferent(obj1[key], obj2[key]);
			}
		} else {
			if(obj1[key] != obj2[key]){
				objDifferent[key] = obj1[key];
				obj2[key] = obj1[key];
			} else{
				return ;
			}
		}
	}
	for (key in objDifferent){
		if(objDifferent[key] != undefined)
		del = false;		
	}
	if(del)
		return ;
	return objDifferent;
}

module.exports.deepCopy = deepCopy;
module.exports.getDifferent = getDifferent;