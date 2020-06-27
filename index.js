
'use strict';

//	I'm not the best NodeJS programmer so this is just here to make sure I don't do anything stupid.
const memwatch = require('memwatch-next');
memwatch.on('leak', (info) => 
{
  console.error('Memory leak detected:\n', info);
  
  var leakMessage = "Memory Leak Detected";
	fs.writeFile('memoryLeakDetected.txt', leakMessage, function (err) 
	{
		if (err) throw err;
		console.log('Saved MemLeak!');
	});
  
});

var app = require('express')();