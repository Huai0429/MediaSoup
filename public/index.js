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
    encoding:[
      {
        rid:'r0',
        maxBitrate:100000,
        scalabilityMode:'S1T3',
      },
      {
        rid:'r1',
        maxBitrate:300000,
        scalabilityMode:'S1T3',
      },
      {
        rid:'r2',
        maxBitrate:900000,
        scalabilityMode:'S1T3',
      },
    ],
    codecOptions:{
      videoGoogleStartBitrate:1000
    }
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
let producerTransport
// after click button 2 getRtpCapabilities
const getRtpCapabilities = ()=>{
  socket.emit('getRtpCapabilities',(data)=>{
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    // document.querySelector('#Rtp_Capabilities').textContent = 'Rtp Capabilities: '+data.rtpCapabilities
    rtpCapabilities = data.rtpCapabilities
  })
}

const createSendTransport=()=>{
  console.log('Start to create Send Transport as WebRtc transport...')

  socket.emit('createWebRtcTransport',{sender:true},({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    document.querySelector('#WebRtc_send_Transport_id').textContent = 'WebRtc "Send" Transport id: '+params.id
    console.log(params)
    console.log('already create waiting for connect')

    //transport connect event for producer'
    //https://mediasoup.org/documentation/v3/communication-between-client-and-server/#creating-transports
    producerTransport = device.createSendTransport(params)

    producerTransport.on('connect',async({dtlsParameters},callback,errback)=>{ // produce connect-2
      try{
        // DTLS parameters to the server side transport
        await socket.emit('transport-connect',{
          // transportId:producerTransport.id,
          dtlsParameters: dtlsParameters,
        })

        // tell the transport that parameters were transmitted
        callback()
      }catch(error){
        errback(error)
      }
    })

    producerTransport.on('produce',async(parameters,callback,errback)=>{
      console.log(parameters)

      try{
        await socket.emit('transport-produce',{
          // transportId: producerTransport.id,
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData:parameters.appData,
        },({id})=>{
          // Tell the transport that parameters were transmitted and provide it with the
          // server side producer's id.
          callback({id}) //callback to transport-produce or producer id 
          document.querySelector('#Producer_ID').textContent = 'Producer ID: '+id
        })
        
      }catch(error){
        errback(error)
      }
    })
  })
}

//producer different from producer transport
let producer

const connectSendTransport = async()=>{
  producer = await producerTransport.produce(params) // produce connect-1

  producer.on('trackended',()=>{
    console.log('track ended')

    // close video track
  })

  producer.on('transportclose',()=>{
    console.log('transport ended')

    // close video track
  })
}

let consumerTransport 
let consumer
const createRecvTransport = async()=>{
  await socket.emit('createWebRtcTransport',{sender:false},({params}) =>{
    if(params.error){
      console.log(params.error)
      return
    }
    document.querySelector('#WebRtc_Recv_Transport_id').textContent = 'WebRtc "Recv" Transport id: '+params.id
    console.log(params)

    // create recv transport
    consumerTransport = device.createRecvTransport(params)
    consumerTransport.on('connect',async({dtlsParameters},callback,errback)=>{
      try{
        //signal local DTLS parameters to the server side transport
        await socket.emit('transport-recv-connect',{
          // transportId:consumerTransport.id,
          dtlsParameters,
        })
        //Tell transport that parameters were tansmitted
        callback()
      }catch(error){
        //tell transport that something goes wrong
        errback(error)
      }
    })
  })
}


const connectRecvTransport = async()=>{
  await socket.emit('consume',{
    rtpCapabilities:device.rtpCapabilities,
  },async({params})=>{
    if(params.error){
      console.log(`Cannot Consume ${params.error}`)
      return
    }

    console.log(params)
    consumer = await consumerTransport.consume({
      id:params.id,
      producerId:params.producerId,
      kind:params.kind,
      rtpParameters:params.rtpParameters
    })

    const{track} = consumer
    
    remoteVideo.srcObject = new MediaStream([track])

    socket.emit('consumer-resume')
  })
}



btnLocalVideo.addEventListener('click', getLocalStream)
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click', createDevice)
btnCreateSendTransport.addEventListener('click', createSendTransport)
btnConnectSendTransport.addEventListener('click', connectSendTransport)
btnRecvSendTransport.addEventListener('click', createRecvTransport)
btnConnectRecvTransport.addEventListener('click', connectRecvTransport)



