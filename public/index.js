const io = require('socket.io-client')
const mediasoupClient = require('mediasoup-client')
const roomName = window.location.pathname.split('/')[2]

const socket = io("/mediasoup") 
let device
let rtpCapabilities
let rtpCapabilities2
let producerTransport
let producer
let consumerTransports =[]
let consumer
let isProducer = false
let R2consumerTransport = []
let R2producerTransport
let R2producer
let R2consumer
let WhichTransport

socket.on('connection-success' , ({ socketId,existsProducer }) => { //'connection-success' event
    console.log(socketId,existsProducer)
    document.querySelector('#socketID').textContent = 'socketID: '+socketId
    getLocalStream()
})


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
let params1
let params2
const streamSuccess = (stream)=>{ //success callback
    localVideo.srcObject = stream
    const track = stream.getVideoTracks()[0]
    // console.log(track)
    params = { //get video track add to params
        track,
        ...params
    }

    // goConnect(true)
    joinRoom()
}
const joinRoom = () =>{
  socket.emit('joinRoom',{roomName},(data)=>{
    console.log('joinRoom')
    rtpCapabilities = data.rtpCapabilities
    rtpCapabilities2 = data.rtpCapabilities2
    createDevice()
  })
}
const getLocalStream = () => {
    navigator.mediaDevices.getUserMedia({
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
    }).then(streamSuccess).catch(error=>{
      console.log(error.message)
    })
}

const goConsume = () => {
  goConnect(false)
}

const goConnect = (ProducerOrConsumer)=>{
  isProducer = ProducerOrConsumer
  device === undefined ? getRtpCapabilities():goCreateTransport()
}

async function goCreateTransport(){
  if(isProducer){
    createSendTransport(true)
    // await delay(50);
    // createRecvTransport(false,true)
    // createRecvTransport(true)
    // await delay(50);
    // createSendTransport(false)//R2
  }else{
    //createRecvTransport(false,true)
    signalNewConsumerTransport(false,true)
    // createRecvTransport(true,false)
    //createSendTransport(false)
  }
}

//creat Device as https://mediasoup.org/documentation/v3/mediasoup-client/api/#Device
//for listener 
const createDevice = async()=>{
  try{
    device = new mediasoupClient.Device()

    await device.load({
      routerRtpCapabilities: rtpCapabilities,
      router2RtpCapabilities: rtpCapabilities2
    })
    console.log('Create Device')
    // console.log('Device RTP Capabilities',device.rtpCapabilities)
    // console.log('Device RTP Capabilities2',device.rtpCapabilities2)
    //after btn2 create device go btn3

    // goCreateTransport()
    createSendTransport(true)

  }catch(error){
    console.log(error)
    if(error.name === 'UnsupportedError')
      console.warn('browser not supported')
  }
}


// after click button 2 getRtpCapabilities
const getRtpCapabilities = ()=>{
  socket.emit('CreateRoom',(data)=>{
    console.log('CreateRoom')
    // console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    // console.log(`Router2 RTP Capabilities... ${data.rtpCapabilities2}`)
    // document.querySelector('#Rtp_Capabilities').textContent = 'Rtp Capabilities: '+data.rtpCapabilities
    rtpCapabilities = data.rtpCapabilities
    rtpCapabilities2 = data.rtpCapabilities2
    //btn 3
    createDevice()
  })
}

socket.on('new-producer',({producerId})=>signalNewConsumerTransport(producerId))

const getProducer = () =>{
  socket.emit('getProducer',producerIds =>{
    // for each of the producer create a consumer
    // producerIds.forEach(id => signalNewConsumerTransport(id))
    producerIds.forEach(signalNewConsumerTransport)
  })
}

const createSendTransport=(mode)=>{
  console.log('Start to create Send Transport as WebRtc transport...')

  // socket.emit('createWebRtcTransport',{sender:true,mode:mode},({params})=>{
  socket.emit('createWebRtcTransport',{consumer:false,mode:mode},({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    if(mode){
      params1 = params
      document.querySelector('#WebRtc_send_Transport_id').textContent = 'WebRtc "Send" Transport on router1 id: '+params.id
      producerTransport = device.createSendTransport(params1)
      WhichTransport = producerTransport
    }
    else{
      params2 = params
      document.querySelector('#R2_WebRtc_send_Transport_id').textContent = 'WebRtc "Send" Transport on router2 id: '+params.id
      R2producerTransport = device.createSendTransport(params2)
      WhichTransport = R2producerTransport
    }
    
    
    console.log('Create "Send Transport" Successful and waiting for connect')
    // console.log(WhichTransport.id)
    // console.log(R2producerTransport.id)
    // console.log(producerTransport.id)

    //transport connect event for producer'
    //https://mediasoup.org/documentation/v3/communication-between-client-and-server/#creating-transports
    

    WhichTransport.on('connect',async({dtlsParameters},callback,errback)=>{ // produce connect-2
      try{
        // DTLS parameters to the server side transport
        await socket.emit('transport-connect',{
          // transportId:WhichTransport.id,
          dtlsParameters: dtlsParameters,
          mode:mode,
        })

        // tell the transport that parameters were transmitted
        callback()
      }catch(error){
        errback(error)
      }
    })
    WhichTransport.on('produce',async(parameters,callback,errback)=>{
      console.log(parameters)

      try{
        await socket.emit('transport-produce',{
          // transportId: producerTransport.id,
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData:parameters.appData,
          mode:mode
        },({id,producerexist})=>{
          // Tell the transport that parameters were transmitted and provide it with the
          // server side producer's id.
          callback({id}) //callback to transport-produce or producer id
          // if producer exist
          if(producerexist)
            getProducer()
          if(mode) 
            document.querySelector('#Producer_ID').textContent = 'R1 Producer ID: '+id
          else
            document.querySelector('#R2_Producer_ID').textContent = 'R2 Producer ID: '+id
        })
        
      }catch(error){
        errback(error)
      }
    })
    connectSendTransport(mode)
    
  })
}

//producer different from producer transport

const connectSendTransport = async(mode)=>{
  if(mode){
    producer = await WhichTransport.produce(params) // produce connect-1
    producer.on('trackended',()=>{
      console.log('track ended')

      // close video track
    })

    producer.on('transportclose',()=>{
      console.log('transport ended')

      // close video track
    })
  }else{
    R2producer = await WhichTransport.produce(params) // produce connect-1
    R2producer.on('trackended',()=>{
      console.log('track ended')

      // close video track
    })

    R2producer.on('transportclose',()=>{
      console.log('transport ended')

      // close video track
    })
  }
  try{
    await socket.emit('PipeToRouter',(PipeID)=>{
      console.log('PipeID',PipeID)
      // console.log('Pipe2',Pipe2)

    })
  }catch(error){
    console.log('PipeToRouter error')
    console.log(error)
  }
  console.log('Pipe to Router complete')
  
  
    // createSendTransport(false)//R2
  // goConsume()
}


// const createRecvTransport = async(mode,isPipe)=>{
const signalNewConsumerTransport = async(remoteProducerId,mode,isPipe)=>{
    // await socket.emit('createWebRtcTransport',{sender:false,mode:mode},({params}) =>{
    await socket.emit('createWebRtcTransport',{consumer:true,mode:mode},({params}) =>{
      if(params.error){
        console.log(params.error)
        return
      }
      // create recv transport
      if(mode){
        document.querySelector('#WebRtc_Recv_Transport_id').textContent = 'WebRtc "Recv" Transport on router1 id: '+params.id
        console.log('Create "Recv Transport" Successful and waiting for connect')
        let consumerTransport = device.createRecvTransport(params)
        console.log(`consumerTransportID:${consumerTransport.id}`)
        WhichTransport = consumerTransport
      }else{
        document.querySelector('#R2_WebRtc_Recv_Transport_id').textContent = 'WebRtc "Recv" Transport on router2 id: '+params.id
        console.log('Create "Recv Transport" Successful and waiting for connect')
        R2consumerTransport = device.createRecvTransport(params)
        console.log(`R2consumerTransportID:${R2consumerTransport.id}`)
        WhichTransport = R2consumerTransport
      }
      
      WhichTransport.on('connect',async({dtlsParameters},callback,errback)=>{
        try{
          const stats = await WhichTransport.getStats();
          console.log('WhichTransport',stats)
          //signal local DTLS parameters to the server side transport
          // console.log(`R2${dtlsParameters}`)
          await socket.emit('transport-recv-connect',{
            // transportId:WhichTransport.id,
            dtlsParameters:dtlsParameters,
            mode:mode,
            isPipe:isPipe,
          })
          //Tell transport that parameters were tansmitted
          callback()
        }catch(error){
          //tell transport that something goes wrong
          errback(error)
        }
      })
      // connectRecvTransport(mode)
      connectRecvTransport(WhichTransport,remoteProducerId,params.id,mode)
    })
}

// const connectRecvTransport = async(mode)=>{
const connectRecvTransport = async(consumerTransport,remoteProducerId,serverConsumerTransportId,mode)=>{
  await socket.emit('consume',{
    rtpCapabilities:mode?device.rtpCapabilities:device.rtpCapabilities2,
    remoteProducerId,
    serverConsumerTransportId,
    mode:mode,
  },async({params})=>{
    if(params.error){
      if(mode)
        console.log(`1${device.rtpCapabilities}`)
      else
        console.log(`2${device.rtpCapabilities2}`)
      console.log(`Cannot Consume ${params.error}`)
      return
    }
    if(mode){
      console.log(params)
      const consumer = await consumerTransport.consume({
        id:params.id,
        producerId:params.producerId,
        kind:params.kind,
        rtpParameters:params.rtpParameters
      })
      document.querySelector('#Consumer_ID').textContent = 'Consumer ID :'+params.id
      document.querySelector('#Consume_Producer_ID').textContent = 'Consume from Producer :'+params.producerId
      consumerTransports = [
        ...consumerTransports,
        {
          consumerTransport,
          serverConsumerTransportId:params.id,
          producerId:remoteProducerId,
          consumer
        }
      ]
    }else{
      console.log('R2consumer',params)
      const R2consumer = await R2consumerTransport.consume({
        id:params.id,
        producerId:params.producerId,
        kind:params.kind,
        rtpParameters:params.rtpParameters
      })
      document.querySelector('#Consumer_ID').textContent = 'Consumer ID :'+params.id
      document.querySelector('#Consume_Producer_ID').textContent = 'Consume from Producer :'+params.producerId
      R2consumerTransport = [
        ...R2consumerTransport,
        {
          R2consumerTransport,
          serverConsumerTransportId:params.id,
          producerId:remoteProducerId,
          R2consumer
        }
      ]
    }
    
    const newElem = document.createElement('div')
    newElem.setAttribute('id',`td-${remoteProducerId}`)
    newElem.setAttribute('class','remoteVideo')
    newElem.innerHTML = '<video id="'+remoteProducerId+'"autoplay class="video"></video>'
    videoContainer.appendChild(newElem)
    
    if (!mode){
      console.log('Consume for Remote Video')
      const{track} = R2consumer
      // console.log(track)
      // remoteVideo.srcObject = new MediaStream([track])
      document.getElementById(remoteProducerId).srcObject = new MediaStream([track])
      // socket.emit('consumer-resume',{mode})  
      socket.emit('consumer-resume',{mode,ServerConsumerid:params.serverConsumerId})  
    }
    
  })
}

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

socket.on('producer-closed',({remoteProducerId,mode})=>{
  // server notification is received when a producer is closed
  // we need to close the client-side consumer and associated transport
  const producerToClose = consumerTransports.find(transportData=>transportData.producerId===remoteProducerId)
  producerToClose.consumerTransport.close()
  producerToClose.consumer.close()

  // remove the consumer transport from the list
  consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)

  // remove the video div element
  videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
})

// btnLocalVideo.addEventListener('click', getLocalStream)
// btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
// btnDevice.addEventListener('click', createDevice)
// btnCreateSendTransport.addEventListener('click', createSendTransport)
// btnConnectSendTransport.addEventListener('click', connectSendTransport)
// btnRecvSendTransport.addEventListener('click', goConsume)
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport)



