const io = require('socket.io-client')
const mediasoupClient = require('mediasoup-client')


const socket = io("/mediasoup") 

socket.on('connection-success' , ({ socketId }) => { //'connection-success' event
    console.log(socketId)
    document.querySelector('#socketID').textContent = 'socketID: '+socketId
})

let device

let params = {
    //mediasoup params
}

const streamSuccess = async (stream)=>{ //success callback
    localVideo.srcObject = stream
    const track = stream.getVideoTracks()[0]
    params = { //get video track add to params
        track,
        ...params
    }
}

const getLocalStream = () => {
    navigator.getUserMedia({
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        }
      }
    }, streamSuccess, error => {
      console.log(error.message)
    })
}

//creat Device as https://mediasoup.org/documentation/v3/mediasoup-client/api/#Device
//for listener 
const createDevice = async()=>{
  try{
    device = new mediasoupClient.Device()

    await device.load({
      routerRtpCapabilities: rtpCapabilities
    })
    console.log('Create Device')
    console.log('RTP Capabilities',device.rtpCapabilities)
  }catch(error){
    console.log(error)
    if(error.name === 'UnsupportedError')
      console.warn('browser not supported')
  }
}

let rtpCapabilities

// after click button 2 getRtpCapabilities
const getRtpCapabilities = ()=>{
  socket.emit('getRtpCapabilities',(data)=>{
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    rtpCapabilities = data.rtpCapabilities
  })
}

const createSendTransport=()=>{
  socket.emit('createWebRtcTransport',{sender:true},({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    console.log(params)
  })
}

btnLocalVideo.addEventListener('click', getLocalStream)
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click', createDevice)
btnCreateSendTransport.addEventListener('click', createSendTransport)
// btnConnectSendTransport.addEventListener('click', connectSendTransport)
// btnRecvSendTransport.addEventListener('click', createRecvTransport)
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport)



