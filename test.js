const { markdownToDelta } = require('./src/markdownToDelta');

console.log(markdownToDelta('## Hello World'));

async function go() {
    // sleep for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('done');
}

go()