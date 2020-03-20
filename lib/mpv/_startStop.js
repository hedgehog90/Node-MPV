'use strict';

const net   = require('net');
const spawn = require('child_process').spawn;

const util		   = require('../util');

const startStop = {
	// Starts the MPV player process
	//
	// After MPV is started the function listens to the spawned MPV child proecesses'
	// stdout for see whether it could create and bind the IPC socket or not.
	// If possible an ipcInterface is created to handle the socket communication
	//
	// Observes the properties defined in the observed object
	// Sets up the event handlers
	//
	// @return
	// Promise that is resolved when everything went fine or rejected when an
	// error occured
	//
	start: function() {
		// check if mpv is already running
		return new Promise((resolve, reject) => {
			return this.running ? reject(this.errorHandler.errorMessage(6, 'start()')) : resolve();
		})
		// check if the binary is actually available
		.then(() => util.checkMpvBinary(this.options.binary))
		// check for the corrrect ipc command
		.then(() => util.findIPCCommand(this.options))
		// check if mpv could be started succesffuly
		.then((ipcCommand) => {
			return new Promise((resolve, reject) => {
				// add the ipcCommand to the arguments
				this.mpv_arguments.push(ipcCommand+'='+this.options.socket);
				// Spawns the mpv player
				this.mpvPlayer = spawn((this.options.binary ? this.options.binary : 'mpv'), this.mpv_arguments);
				// Listen to stdout + stderr to see, if MPV could bind the IPC socket
				var stdCallback = (data) => {
					// stdout/stderr output
					const output = data.toString();
					// "Listening to IPC socket" - message
					if(output.match(/Listening to IPC (socket|pipe)/)){
						// remove the event listener on stdout
						this.mpvPlayer.stderr.removeAllListeners('data');
						this.mpvPlayer.stdout.removeAllListeners('data');
						resolve();
					}
					// "Could not bind IPC Socket" - message
					else if(output.match(/Could not bind IPC (socket|pipe)/)){
						// remove the event listener on stdout
						this.mpvPlayer.stderr.removeAllListeners('data');
						this.mpvPlayer.stdout.removeAllListeners('data');
						reject(this.errorHandler.errorMessage(4, 'startStop()', [this.options.socket]));
					}
				};
				this.mpvPlayer.stdout.on('data', stdCallback);
				this.mpvPlayer.stderr.on('data', stdCallback);
			});
		})
		.then(() => {
			return new Promise((resolve, reject) => {
				// Set up the socket connection
				this.socket.connect(this.options.socket);
				// socket to check for the idle event to check if mpv fully loaded and
				// actually running
				const observeSocket = net.Socket();
				observeSocket.connect({path: this.options.socket}).on('data', (data) => {
					// parse the messages from the socket
					const messages = data.toString('utf-8').split('\n');
					// check every message
					for (var message of messages) {
						// ignore empty messages
						if(message.length > 0){
							message = JSON.parse(message);
							// console.log(message);
							if('event' in message && ['idle','file-loaded'].indexOf(message.event)!==-1){
								observeSocket.destroy();
								return resolve();
							}
						}
					}
				});
			});
		})
		// If the promise was resolved continue initializing the socket communication
		.then(() => {
			// sets the Interval to emit the current time position
			this.observeProperty('time-pos', 0);
			this.timepositionListenerId = setInterval(() => {
				// only emit the time position if there is a file playing and it's not paused
				if(this.observed.filename && !this.observed.pause && this.currentTimePos != null){
					this.emit("timeposition", this.currentTimePos);
				}
			}, this.options.time_update * 1000);

			// Observe all the properties defined in the observed JSON object
			let id = 1; // 0 is for time-pos
			let observePromises = [];
			Object.keys(this.observed).forEach((property) => {
				// safety check
				if(property in this.observed){
					observePromises.push(this.observeProperty(property, id));
					this.observedIDs[id] = property;
					id += 1;
				}
			});
						
			return Promise.all(observePromises);
		})
		.then(() => {
			
			// ### Events ###

			// Close Event. Restarts MPV
			this.mpvPlayer.on('close', (error_code) => this.closeHandler(error_code));

			// Output any errors thrown by MPV
			this.mpvPlayer.on('error', (error) => this.errorHandler(error));

			// Handle the JSON messages received from MPV via the ipcInterface
			this.socket.on('message', (message) => this.messageHandler(message));


			// set the running flag
			this.running = true;

			// resolve this promise
			return;
		});
	},
	// Quits the MPV player
	//
	// All event handlers are unbound (thus preventing the close event from
	// restarting MPV
	// The socket is destroyed
	quit: function() {
		// Clear all the listeners of this module
		this.mpvPlayer.removeAllListeners('close');
		this.mpvPlayer.removeAllListeners('error');
		this.mpvPlayer.removeAllListeners('message');
		clearInterval(this.timepositionListenerId);
		// send the quit message to MPV
		this.command("quit");
		// Quit the socket
		this.socket.quit();
		// unset the running flag
		this.running = false;
	},
	// Shows wheters mpv is running or not
	//
	// @return {boolean}
	isRunning: function() {
		return this.running;
	}
}

module.exports = startStop;
