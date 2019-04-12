'use strict';

var globalLog = false;

const fs = require('fs');
const readLine = require('readline');
const usb = require('usb');
const sprintf = require('sprintf-js').sprintf;
const vsprintf = require('sprintf-js').vsprintf;

const controlCharacters = {
	SOH: 0x01,
	EOT: 0x04,
	DLE: 0x10
};

const commands ={
	VERSION: 0x01,
	ERASE: 0x02,
	PROGRAM: 0x03,
	READ: 0x04,
	APPLICATION: 0x05
};

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

function pad(num, size) {
    var s = num+"";
    while (s.length < size) s = "0" + s;
    return s;
}

function dataArray(buffer){
	var result = [];
	for(var i = 0;i < buffer.length;i++){
		result.push(pad(buffer[i].toString(16).replace("0x","").substring(0,2),2));
	}
	return result;
}

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

function lsb(data){ return data & 0xF; }
function msb(data){ return data >> 4; }

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

function decodeFrame(value,command){
	var data = [];
	var scape = false;
	for(var i = 0;i < value.length;i++){
		if(scape){
			data.push(value[i]);
			scape = false;
		}else{
			if(value[i] == controlCharacters.SOH){
				if(globalLog) console.log("Invalid characters on data");
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
					if(globalLog) console.log("Invalid data CRC");
					return;
				}
			}
			data.push(value[i]);
		}
	}
	if(globalLog) console.log("Invalid data format");
	return;
}

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
					// According to bootloader library documentation, the first byte is the major version, but the pic define the struct and in fact return the first byte as the major and second as minor
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
				if(globalLog) console.log("Unknown command frame");
		}

		if(!response){
			if(globalLog) console.log("Invalid frame command format");
		}else{
			response.command = command;
		}
	}else{
		if(globalLog) console.log("Invalid frame");
	}
	return response;
}

module.exports = class MchPicUsbHidBootloader{
	constructor(appFlashBaseAddress, appFlashEndAddress) {
		this.writeApplicationPending = false;
		this.writeApplicationCRCData = false;
		this.writeApplicationCRCStatus;

    	this.appFlashBaseAddress = appFlashBaseAddress;
    	this.appFlashEndAddress = appFlashEndAddress;
    	this.hexFile;
    	this.debug = false;
    	this.debugUsb = false;
	}

	setDebug(option){
		this.debug = option;
		globalLog = this.debug;
	}

	setUsbDebug(option){
		this.debugUsb = option;
	}

	log(trace){
		if(this.debug) console.log(trace);
	}

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
	}

	closeUsb(){
		this.inEndPoint.stopPoll();
	    this.device.interfaces[0].release(true,function(err){
	        this.log("Error on interface release");
	    }.bind(this));
	    this.device.close();
	}

	sendCommand(data){
		var result = new Promise(function(resolve, reject) {
			this.outEndPoint.transfer(sendFrame(data),function(err){
		        if(err){
		        	reject("Command error " + err);
		        }else{
		        	resolve();
		        }
			});
		}.bind(this));
		return result;
	}

	readCommand(data){
		if(data){
			var response = readFrame(data);
			if(response && (response.command || response.command === 0)){
				switch(response.command){
					case commands.VERSION:
						this.log("Bootloader version - Major: " + response.majorVer + ", Minor: " + response.minorVer);
						return response;
					break;
					case commands.ERASE:
						this.log("Bootloader erase command: " + response.command + ", success");
						return response;
					break;
					case commands.PROGRAM:
						this.log("Bootloader program command: " + response.command + ", success");
						return response;
					break;
					case commands.READ:
						if(this.writeApplicationPending){
							var dataCrc = ((response.flash_crch << 8) + response.flash_crcl).toString(16);
							var calcCrc = crc16UsbRead(Buffer.from(this.writeApplicationCRCData,"hex"));
							this.writeApplicationCRCStatus = {crcResponseData:{flash_crcl:response.flash_crcl,flash_crch:response.flash_crch},dataCRC:dataCrc,calculatedCRC:calcCrc};
							this.writeApplicationCRCStatus.statusOk = (dataCrc == calcCrc);
						}
						this.log("Bootloader CRC - FLASH_CRCL: " + response.flash_crcl + ", FLASH_CRCH: " + response.flash_crch);
						return response;
					break;
					case commands.APPLICATION:
						// No response from JUMP to application command
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

	eraseAndWrite(file,jumpToApp){
		var result = new Promise(function(resolve, reject) {
			this.sendCommand(Buffer.from([commands.ERASE])).then(function(){
				this.writeApplication(file,jumpToApp).then(function(value){
					resolve(value);
				}).catch(function(subErr){
					reject(subErr);
				});
			}.bind(this)).catch(function(err){
				reject(err);
			});
		}.bind(this));
		return result;
	}

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

					        	scope.writeApplicationPending = true;
					        	scope.writeApplicationCRCData = crcDataGroupsObjs[crcGprCount].data;
					        	var crcCheck = setInterval(function(){
					        		if(scope.writeApplicationCRCStatus){
					        			scope.writeApplicationPending = false;
					        			scope.writeApplicationCRCData = false;

					        			if(scope.writeApplicationCRCStatus.statusOk){
					       					scope.writeApplicationCRCStatus = false;

					        				crcGprCount++;
					        				checkCrcGroups();
					        			}else{
					        				scope.log(sprintf('CRC check fail for line %s, at index %s, with FLASH_CRCL %s - FLASH_CRCH %s : FLASH response CRC %s, and program calculated CRC %s', data[crcDataGroupsObjs[crcGprCount].count], crcDataGroupsObjs[crcGprCount].count, 
					        				scope.writeApplicationCRCStatus.crcResponseData.flash_crcl,scope.writeApplicationCRCStatus.crcResponseData.flash_crch,scope.writeApplicationCRCStatus.dataCRC,scope.writeApplicationCRCStatus.calculatedCRC));
					        				scope.writeApplicationCRCStatus = false;

					        				scope.sendCommand(Buffer.from([commands.ERASE])).then(function(value){
												reject("Erase ok");
					        				}).catch(function(err){
					        					reject("Erase error " + err);
					        				});
					        			}

					        			clearInterval(crcCheck);
					        		}
					        	},100);
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