'use strict';

/* GLOBALS */

// Enable / Disable global log
var globalLog = false;

const fs = require('fs');
const readLine = require('readline');
const usb = require('usb');
const sprintf = require('sprintf-js').sprintf;
const vsprintf = require('sprintf-js').vsprintf;
const uuidv1 = require('uuid/v1');

// Control Characters constant values
// DOC: https://github.com/Zarpen/mchpic-usbhid-bootloader/blob/master/doc/01388B.pdf, https://github.com/Zarpen/mchpic-usbhid-bootloader/blob/master/doc/01388B.pdf
const controlCharacters = {
	SOH: 0x01,
	EOT: 0x04,
	DLE: 0x10
};

// Commands constants values
// DOC: https://github.com/Zarpen/mchpic-usbhid-bootloader/blob/master/doc/01388B.pdf, https://github.com/Zarpen/mchpic-usbhid-bootloader/blob/master/doc/01388B.pdf
const commands ={
	VERSION: 0x01,
	ERASE: 0x02,
	PROGRAM: 0x03,
	READ: 0x04,
	APPLICATION: 0x05
};

// Define if the program execution environment uses little endian
const isLittleEndian = (()=>{
    var buf = new ArrayBuffer(4);
    var buf8 = new Uint8ClampedArray(buf);
    var data = new Uint32Array(buf);
    data[0] = 0x0F000000;
    if(buf8[0] === 0x0f){
        return false;
    }else{
    	return true;
    }
})();

/**
* This function pad number with zeroes for x minimum length
*
* @param num (int) the number to pad
* @param size (int) the length to pad
* @return (String) padded number
*/
function pad(num, size) {
    var s = num+"";
    while (s.length < size) s = "0" + s;
    return s;
}

/**
* This function format buffer value to data
*
* @param buffer (Buffer) buffer object
* @return (String Array) data strings
*/
function dataArray(buffer){
	var result = [];
	for(var i = 0;i < buffer.length;i++){
		result.push(pad(buffer[i].toString(16).replace("0x","").substring(0,2),2));
	}
	return result;
}

/**
* This function calculate crc16 of data for the send function
*
* @param value (String/Buffer) data
* @return (Buffer) crc16 value
*/
function crc16UsbSend(value){
	var i;
    var crc = 0;
    var crc_table =
	[
	    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
	    0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef
	];
	var data = value instanceof String ? new Buffer(value,"hex") : value;
	var len = data.length;
	var count = 0;
    
    while(len--)
    {
        i = (crc >> 12) ^ data[count] >> 4;
        crc = crc_table[i & 0x0F] ^ (crc << 4);
        i = (crc >> 12) ^ data[count] >> 0;
        crc = crc_table[i & 0x0F] ^ (crc << 4);
        count++;
    }

	return new Buffer((crc & 0xFFFF).toString(16),"hex");
}

/**
* This function calculate crc16 of data for the read function
*
* @param value (String/Buffer) data
* @return (Buffer) crc16 value
*/
function crc16UsbRead(value){
	var i;
    var crc = 0;
    var crc_table =
	[
	    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
	    0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef
	];
	var data = value instanceof String ? new Buffer(value,"hex") : value;
	data = dataArray(value);
	var len = data.length;
	var count = 0;
    
    while(len--)
    {
        i = (crc >> 12) ^ parseInt(data[count],16) >> 4;
        crc = crc_table[i & 0x0F] ^ (crc << 4);
        i = (crc >> 12) ^ parseInt(data[count],16) >> 0;
        crc = crc_table[i & 0x0F] ^ (crc << 4);
        count++;
    }

	return (crc & 0xFFFF).toString(16);
}

/**
* This function calculate the less significant bit
*
* @param value (Buffer) data
* @return (Buffer) LSB value
*/
function lsb(data){ return data & 0xF; }
/**
* This function calculate the most significant bit
*
* @param value (Buffer) data
* @return (Buffer) MSB value
*/
function msb(data){ return data >> 4; }
/**
* This method log the received message
*
* @param value (String) msg
*/
function log(msg){
	if(globalLog) console.log(msg);
}

/**
* This function create a frame with the formatted data to be send to the device
*
* @param value (Buffer) value
* @return (Buffer) frame
*/
function sendFrame(value){
	var data = value.length || value.length === 0 ? value : [value];
	var crc = crc16UsbSend(data);
	var frame = [controlCharacters.SOH];
	for(var i = 0;i < data.length;i++){
		if(data[i] == controlCharacters.SOH || data[i] == controlCharacters.EOT || data[i] == controlCharacters.DLE){
			frame.push(controlCharacters.DLE);
			frame.push(data[i]);
		}else{
			frame.push(data[i]);
		}
	}
	frame.push(lsb(crc));
	frame.push(msb(crc));
	frame.push(controlCharacters.EOT);
	return Buffer.from(frame);
}

/**
* This function decodes a frame received from the device
*
* @param value (Buffer) value
* @param value (Command enum constant) command
* @return (Void)
*/
function decodeFrame(value,command){
	var data = [];
	var scape = false;
	for(var i = 0;i < value.length;i++){
		if(scape){
			data.push(value[i]);
			scape = false;
		}else{
			if(value[i] == controlCharacters.SOH){
				log("Invalid characters on data");
				return;
			}
			if(value[i] == controlCharacters.DLE){
				scape = true;
				continue;
			}
			if(value[i] == controlCharacters.EOT){
				var tmpBuf = Buffer.from(data);
				var dataCrc = (tmpBuf[data.length-2] + (tmpBuf[data.length-1] << 8)).toString(16);
				var calcCrc = crc16UsbRead(Buffer.concat([command,tmpBuf]).slice(0,-2));
				if(dataCrc == calcCrc){
					return tmpBuf.slice(0,-2);
				}else{
					log("Invalid data CRC");
					return;
				}
			}
			data.push(value[i]);
		}
	}
	log("Invalid data format");
	return;
}

/**
* This function read a frame from the device and try to decode it
*
* @param value (Buffer) value
* @return (Object) decoded data
*/
function readFrame(value){
	var response;
	if(value[0] == controlCharacters.SOH){
		var decodedData;
		var offset = value[1] == controlCharacters.DLE ? 3 : 2;
		var command = value[1] == controlCharacters.DLE ? value[2] : value[1];
		switch(command){
			case commands.VERSION:
				decodedData = decodeFrame(value.slice(offset),Buffer.from([command]));
				if(decodedData){
					// According to bootloader library documentation, the first byte is the major version, but the pic define the struct and in fact return the first byte as the major and second as minor
					response = {
						minorVer: decodedData[0],
						majorVer: decodedData[1]
					};
				}
			break;
			case commands.ERASE:
				decodedData = decodeFrame(value.slice(offset),Buffer.from([command]));
				if(decodedData) response = {};
			break;
			case commands.PROGRAM:
				decodedData = decodeFrame(value.slice(offset),Buffer.from([command]));
				if(decodedData) response = {};
			break;
			case commands.READ:
				decodedData = decodeFrame(value.slice(offset),Buffer.from([command]));
				if(decodedData){
					response = {
						flash_crcl: decodedData[0],
						flash_crch: decodedData[1]
					};
				}
			break;
			case commands.APPLICATION:
				// No response from JUMP to application command
			break;
			default:
				log("Unknown command frame");
		}

		if(!response){
			log("Invalid frame command format");
		}else{
			response.command = command;
		}
	}else{
		log("Invalid frame");
	}
	return response;
}

/**
* 
* Microchip PIC USB-HID Bootloader Communication Library
*
* This class performs basic communication with Microchip Harmony Framework v1.11 Bootloader
+
* @author  Alberto Romo Valverde
* @version 1.0
* @since   2019-04-15
*/
module.exports = class MchPicUsbHidBootloader{
   /**
   * Constructor for the class, it takes the flash program region boundary
   *
   * @param (String) appFlashBaseAddress Start program flash base address, as defined on linker file and system_config.h
   * @param (String) appFlashEndAddress  End program flash base address, as defined on linker file and system_config.h
   */
	constructor(appFlashBaseAddress, appFlashEndAddress) {
		this.pendingCommands = [];
    	this.appFlashBaseAddress = appFlashBaseAddress;
    	this.appFlashEndAddress = appFlashEndAddress;
    	this.debug = false;
    	this.debugUsb = false;
    	this.commandsTimeout = -1;
    	this.commandsTimeoutInterval;
	}

	/**
    * This method enable or disable the library debug comments
    *
    * @param option (boolean) Takes true | false to enable or disable debug comments
    */
	setDebug(option){
		this.debug = option;
		globalLog = this.debug;
	}

	/**
    * This method configure the usb library debug mode
    *
    * @param option (int) Takes (0 - 4) for different debug level, more info on https://github.com/tessel/node-usb
    */
	setUsbDebug(option){
		this.debugUsb = option;
	}

	/**
    * This method configure the commands timeout, defaults to -1 (no timeout)
    *
    * @param timeout (int) commands timeout in milliseconds
    */
	setTimeout(timeout){
		this.commandsTimeout = timeout;
	}

	/**
    * Debug message if debug enabled
    *
    * @param trace (String) message
    */
	log(trace){
		if(this.debug) console.log(trace);
	}

	/**
    * This method take the device vendor and pid identifiers. It configure and open the usb device library, 
    * also starts usb poll and commands timeout watcher
    *
    * @param vendor (String) usb device vendor
    * @param pid (String) usb device pid
    */
	openUsb(vendor,pid){
		if(this.debugUsb === 0 || this.debugUsb > 0) usb.setDebugLevel(this.debugUsb);
		this.device = usb.findByIds(vendor,pid);
		this.device.open();
		var devInterface = this.device.interfaces[0];
		if(devInterface.isKernelDriverActive()){
			this.log("Detach driver");
			devInterface.detachKernelDriver();
			//devInterface.attachKernelDriver();
		}
		devInterface.claim();
		var inPos = devInterface.endpoints[0].direction == "in" ? 0 : 1;
		var outPos = devInterface.endpoints[1].direction == "out" ? 1 : 0;
		this.inEndPoint = devInterface.endpoints[inPos];
		this.outEndPoint = devInterface.endpoints[outPos];

		this.inEndPoint.startPoll(1,this.inEndPoint.descriptor.wMaxPacketSize);
		this.inEndPoint.on('data',function(d){
			this.log("poll data");
			this.readCommand(d);
		}.bind(this));
		this.inEndPoint.on('error',function(e){
			this.log("Poll error");
			this.log(e);
		}.bind(this));
		this.inEndPoint.on('end',function(){
			this.log("Poll end");
		}.bind(this));

		var scope = this;
		this.commandsTimeoutInterval = setInterval(function(){
			var indexesToComplete = [];
			for(var i = 0;i < scope.pendingCommands.length;i++){
				if(scope.pendingCommands[i].timeout > 0){
					if(((new Date()).getTime() - scope.pendingCommands[i].lastCheck) >= scope.pendingCommands[i].timeout){
						scope.pendingCommands[i].callbackError("Command Timeout");
						indexesToComplete.push(i);
					}
				}
			}
			for(var i = 0;i < indexesToComplete.length;i++) scope.pendingCommands.splice(indexesToComplete[i],1);
		},100);
	}

	/**
    * This method release library resources closing usb device library, usb poll and commands timeout watcher
    */
	closeUsb(){
		this.inEndPoint.stopPoll();
	    this.device.interfaces[0].release(true,function(err){
	        this.log("Error on interface release");
	    }.bind(this));
	    this.device.close();
	    clearInterval(this.commandsTimeoutInterval);
	}

	/**
    * This helper function returns the commands constant
    *
    * @return (Object) commands constant
    */
	static get commands() {
	    return commands;
	}

	/**
    * The function sends a command to the device out endpoint and add the command to the poll
    *
    * @param data (Object) buffer object or buffer array
    * @param timeout (int) the command timeout
    * @return (Object) promise
    */
	sendCommand(data,timeout){
		var scope = this;
		var result = new Promise(function(resolve, reject) {
			scope.outEndPoint.transfer(sendFrame(data),function(err){
		        if(err){
		        	reject("Command error " + err);
		        }else{
		        	scope.pendingCommands.push({
		        		command: data[0],
		        		callback: resolve,
		        		callbackError: reject,
		        		timeout: timeout ? timeout : scope.commandsTimeout,
		        		lastCheck: (new Date()).getTime()
		        	});
		        }
			});
		});
		return result;
	}

	/**
    * This method complete the command on the poll associated with the specific response
    *
    * @param response (Object) command response
    */
	completePending(response){
		var index = -1;
		for(var i = this.pendingCommands.length-1;i >= 0;i--){
			if(this.pendingCommands[i].command == response.command){
				this.pendingCommands[i].callback(response);
				index = i;
				break;
			}
		}
		if(index >= 0) this.pendingCommands.splice(index,1);
	}

	/**
    * This method read command response from device, detect command type and complete it from the pending commands poll
    *
    * @param data (Object) command response data
    */
	readCommand(data){
		if(data){
			var response = readFrame(data);
			if(response && (response.command || response.command === 0)){
				switch(response.command){
					case commands.VERSION:
						this.log("Bootloader version - Major: " + response.majorVer + ", Minor: " + response.minorVer);
						this.completePending(response);
					break;
					case commands.ERASE:
						this.log("Bootloader erase command: " + response.command + ", success");
						this.completePending(response);
					break;
					case commands.PROGRAM:
						this.log("Bootloader program command: " + response.command + ", success");
						this.completePending(response);
					break;
					case commands.READ:
						this.log("Bootloader CRC - FLASH_CRCL: " + response.flash_crcl + ", FLASH_CRCH: " + response.flash_crch);
						this.completePending(response);
					break;
					case commands.APPLICATION:
						this.log("Jump to application response");
						// No response from JUMP to application command
						this.completePending(response);
					break;
					default:
						this.log("Cannot decode response data - unexpected command error");
					break;
				}
			}else{
				this.log("Cannot decode response data - invalid data");
			}
		}else{
			this.log("Cannot decode response data - no data");
		}
	}

	/**
    * This function erase and write the device and return operation promise
    *
    * @param file (String) path to the .hex file
    * @param jumpToApp (boolean) device jump to app after programming flag
    * @return (Object) promise
    */
	eraseAndWrite(file,jumpToApp){
		var result = new Promise(function(resolve, reject) {
			this.sendCommand(Buffer.from([commands.ERASE])).then(function(value){
				this.writeApplication(file,jumpToApp).then(function(subValue){
					resolve(subValue);
				}).catch(function(subErr){
					reject(subErr);
				});
			}.bind(this)).catch(function(err){
				reject(err);
			});
		}.bind(this));
		return result;
	}

	/**
    * This function read the file data and write it to the device
    *
    * @param file (String) path to the .hex file
    * @param jumpToApp (boolean) device jump to app after programming flag
    * @return (Object) promise
    */
	writeApplication(file,jumpToApp){
		var result = new Promise(function(resolve, reject) {
			var readable = fs.createReadStream(file);
			readable.setEncoding("ascii");
			var lineReader = readLine.createInterface({input: readable});
			var data = [];
			var count = 0;
			var extLinAddress = 0;
			var extSegAddress = 0;
			var readCrcData = [];
			var scope = this;

			var writeData = function(){
				if(count == data.length-1){
					scope.log("Application write end");

					var crcDataGroups = {};
					var crcDataGroupsObjs = [];
					var tmpAddr;
					var pickDir = true;
					for(var i = 0;i < readCrcData.length;i++){
						if(pickDir) tmpAddr = readCrcData[i].readAddr;

						if(i + 1 < readCrcData.length){
							if((parseInt(readCrcData[i].readAddr,16) + parseInt(readCrcData[i].readBytes,16)).toString(16) == readCrcData[i+1].readAddr){
								pickDir = false; 
							}else{
								pickDir = true;
							}
						}

						if(crcDataGroups[tmpAddr]){
							crcDataGroups[tmpAddr].bytes += parseInt(readCrcData[i].readBytes,16);
							crcDataGroups[tmpAddr].data += readCrcData[i].readData;
						}else{
							crcDataGroups[tmpAddr] = {
								addr: tmpAddr,
								bytes: parseInt(readCrcData[i].readBytes,16),
								data: readCrcData[i].readData,
								count: readCrcData[i].readAddrCount
							}
						}
					}
					for(var key in crcDataGroups) crcDataGroupsObjs.push(crcDataGroups[key]);

					scope.log(crcDataGroupsObjs);

					var crcGprCount = 0;
					var checkCrcGroups = function(){
						if(crcGprCount >= crcDataGroupsObjs.length){
							if(jumpToApp){
								scope.sendCommand(Buffer.from([commands.APPLICATION]));

								resolve();
							}else{
								resolve();
							}
						}else{
							var dataLen = pad(crcDataGroupsObjs[crcGprCount].bytes.toString(16),8);
							var startReadAddr = crcDataGroupsObjs[crcGprCount].addr;
							var crcDataCmd = ((startReadAddr.substring(6,8)+startReadAddr.substring(4,6))+(startReadAddr.substring(2,4)+startReadAddr.substring(0,2))+
					        		(dataLen.substring(6,8)+dataLen.substring(4,6))+(dataLen.substring(2,4)+dataLen.substring(0,2))).toString(16);

							scope.log(sprintf("Checking CRC Group with addr: %s, bytes: %s and data: %s",startReadAddr,dataLen,crcDataGroupsObjs[crcGprCount].data));

							scope.sendCommand(Buffer.concat([Buffer.from([commands.READ]),Buffer.from(crcDataCmd,"hex")])).then(function(value){
								scope.log("Read CRC ok");



								var dataCrc = ((value.flash_crch << 8) + value.flash_crcl).toString(16);
								var calcCrc = crc16UsbRead(Buffer.from(crcDataGroupsObjs[crcGprCount].data,"hex"));
								if(dataCrc == calcCrc){
									crcGprCount++;
					        		checkCrcGroups();
								}else{
									scope.log(sprintf('CRC check fail for line %s, at index %s, with FLASH_CRCL %s - FLASH_CRCH %s : FLASH response CRC %s, and program calculated CRC %s', data[crcDataGroupsObjs[crcGprCount].count], crcDataGroupsObjs[crcGprCount].count, 
			        				value.flash_crcl,value.flash_crch,dataCrc,calcCrc));

			        				scope.sendCommand(Buffer.from([commands.ERASE])).then(function(value){
										reject("Erase ok");
			        				}).catch(function(err){
			        					reject("Erase error " + err);
			        				});
								}
							}).catch(function(err){
								scope.log("Read CRC error " + err);

					        	scope.sendCommand(Buffer.from([commands.ERASE])).then(function(value){
					        		reject("Erase ok");
					        	}).catch(function(err){
					        		reject("Erase error " + err);
					        	});
							});
						}
					};

					checkCrcGroups();
				}

				scope.sendCommand(Buffer.concat([Buffer.from([commands.PROGRAM]),Buffer.from(data[count].replace(":",""),"hex")])).then(function(value){
			        scope.log("Write line transfer ok");

		        	var tmp = data[count].replace(":","");
		        	var bytes = tmp.substring(0,2);
		        	var addr = tmp.substring(2,6);
		        	var type = tmp.substring(6,8); // 00: general data record, 04: extended address record, 01: end of file
		        	var recData = tmp.substring(8,tmp.length-2);
		        	var Checksum = tmp.substring(tmp.length-2);

		        	if(type == "00"){
		        		// check data CRC of general record (type 00)

			        	scope.log(sprintf('Bytes: %s, Addr: %s, Type: %s, Data: %s, Checksum: %s', bytes, addr, type, recData, Checksum));

						var phyAddr = pad((parseInt(addr,16) + parseInt(extLinAddress,16) + parseInt(extSegAddress,16)).toString(16),8);
						var kva0Addr = pad((parseInt(phyAddr,16) + parseInt("80000000",16)).toString(16),8);
						var dataLen = pad(bytes,8);

			        	scope.log("Physical address: " + phyAddr);
			        	scope.log("Virtual address: " + kva0Addr);
			        	scope.log("Data Len: " + dataLen);

			        	var crcDataCmd = ((kva0Addr.substring(6,8)+kva0Addr.substring(4,6))+(kva0Addr.substring(2,4)+kva0Addr.substring(0,2))+
			        		(dataLen.substring(6,8)+dataLen.substring(4,6))+(dataLen.substring(2,4)+dataLen.substring(0,2))).toString(16);

			        	if(parseInt(kva0Addr,16) >= parseInt(scope.appFlashBaseAddress,16) && parseInt(kva0Addr,16) <= parseInt(scope.appFlashEndAddress,16)){
			        		readCrcData.push({
			        			readAddr: kva0Addr,
			        			readBytes: bytes,
			        			readData: recData,
			        			readAddrCount: count
			        		});
	        			}

	        			count++;
		        		writeData();
		        	}else if(type == "04"){
		        		extLinAddress = ((parseInt(recData.substring(0,2),16)<<24) + (parseInt(recData.substring(2,4),16)<<16)).toString(16);
		        		extSegAddress = 0;
		        		count++;
			        	writeData();
		        	}else if(type == "02"){
		        		extSegAddress = ((parseInt(recData.substring(0,2),16)<<12) + (parseInt(recData.substring(2,4),16)<<4)).toString(16);
		        		extLinAddress = 0;
		        		count++;
			        	writeData();
		        	}else{
		        		extSegAddress = 0;
		        		extLinAddress = 0;
		        	}
				}).catch(function(err){
					scope.log("Write line transfer error " + err);

			        scope.sendCommand(Buffer.from([commands.ERASE])).then(function(value){
						reject("Erase ok");
			        }).catch(function(err){
						reject("Erase error " + err);
			        });
				});
			};

			lineReader.on('line', function (line) {
				data.push(line);
			});

			readable.on('end', function () {
				writeData();
			});
		}.bind(this));
		return result;
	}
}