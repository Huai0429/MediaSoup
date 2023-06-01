/**
 * integrating mediasoup server with a node.js application
 */

/* Please follow mediasoup installation requirements */
/* https://mediasoup.org/documentation/v3/mediasoup/installation/ */
import express from 'express'
const app = express()

import https from 'httpolyglot'
import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()

import { Server } from 'socket.io'
import mediasoup from 'mediasoup'

app.get('*', (req, res, next) => {
  const path = '/sfu/'

  if (req.path.indexOf(path) == 0 && req.path.length > path.length) return next()

  res.send(`You need to specify a room name in the path e.g. 'https://127.0.0.1/sfu/room'`)
})

app.use('/sfu/:room', express.static(path.join(__dirname, 'public')))

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
  cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
}

const httpsServer = https.createServer(options, app)
httpsServer.listen(3000, () => {
  console.log('listening on port: ' + 3000)
})

const io = new Server(httpsServer)

// socket.io namespace (could represent a room?)
const connections = io.of('/mediasoup')

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer 
 **/
let worker
let worker2
let rooms = {}          // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}          // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []     // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []      // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []      // [ { socketId1, roomName1, consumer, }, ... ]
let pipeproducers = []
let pipeconsumers = []

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2100,//2020,
  })
  worker2 = await mediasoup.createWorker({
    rtcMinPort: 3000,
    rtcMaxPort: 3100,//3020,
  })
  console.log(`worker pid ${worker.pid},${worker2.pid}`)

  worker.on('died', error => {
    // This implies something serious happened, so kill the application
    console.error('mediasoup worker has died')
    setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
  })

  return worker,worker2
}

// We create a Worker as soon as our application starts
worker ,worker2 = createWorker()

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
]

connections.on('connection', async socket => {
  console.log(socket.id)
  socket.emit('connection-success', {
    socketId: socket.id,
  })

  const removeItems = (items, socketId, type) => {
    items.forEach(item => {
      if (item.socketId === socket.id) {
        item[type].close()
      }
    })
    items = items.filter(item => item.socketId !== socket.id)

    return items
  }

  socket.on('disconnect', () => {
    // do some cleanup
    console.log('peer disconnected')
    if(peers!==undefined){
      consumers = removeItems(consumers, socket.id, 'consumer')
      producers = removeItems(producers, socket.id, 'producer')
      pipeproducers = removeItems(pipeproducers, socket.id, 'producer')
      pipeconsumers = removeItems(pipeconsumers, socket.id, 'consumer')
      transports = removeItems(transports, socket.id, 'transport')
      const { roomName } = peers[socket.id]
      delete peers[socket.id]

      // remove socket from room
      rooms[roomName] = {
        router: rooms[roomName].router,
        peers: rooms[roomName].peers.filter(socketId => socketId !== socket.id)
      }
    }
  })

  socket.on('joinRoom', async ({ roomName }, callback) => {
    console.log('new peers join \'',roomName,'\'')
    // create Router if it does not exist
    // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)
    const [router1,router2] = await createRoom(roomName, socket.id)
    // const router2 = await createRoom(roomName, socket.id,1)
    peers[socket.id] = {
      socket,
      roomName,           // Name for the Router this Peer joined
      transports: [],
      producers: [],
      pipeproducers: [],
      consumers: [],
      pipeconsumers: [],
      OnRouter_P: [],
      OnRouter_C: [],
      peerDetails: {
        name: '',
        isAdmin: false,   // Is this Peer the Admin?
      }
    }

    // get Router RTP Capabilities
    const rtpCapabilities = router1.rtpCapabilities
    const rtpCapabilities2 = router2.rtpCapabilities
    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities ,rtpCapabilities2})
  })

  const createRoom = async (roomName, socketId) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    let router1
    let router2
    let peers = []
    if (rooms[roomName]) {
      router1 = rooms[roomName].router[0]
      router2 = rooms[roomName].router[1]
      peers = rooms[roomName].peers || []
    } else {
      router1 = await worker.createRouter({ mediaCodecs, })
      router2 = await worker2.createRouter({ mediaCodecs, })
    }
    
    console.log(`Router ID: ${router1.id},${router2.id}`, peers.length)

    rooms[roomName] = {
      router: [router1,router2],
      peers: [...peers, socketId],
    }
    return [router1,router2]
  }

  // socket.on('createRoom', async (callback) => {
  //   if (router === undefined) {
  //     // worker.createRouter(options)
  //     // options = { mediaCodecs, appData }
  //     // mediaCodecs -> defined above
  //     // appData -> custom application data - we are not supplying any
  //     // none of the two are required
  //     router = await worker.createRouter({ mediaCodecs, })
  //     console.log(`Router ID: ${router.id}`)
  //   }

  //   getRtpCapabilities(callback)
  // })

  // const getRtpCapabilities = (callback) => {
  //   const rtpCapabilities = router.rtpCapabilities

  //   callback({ rtpCapabilities })
  // }

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on('createWebRtcTransport', async ({ consumer ,OnRouter}, callback) => {
    // get Room Name from Peer's properties
    const roomName = peers[socket.id].roomName   
    const router = OnRouter? rooms[roomName].router[0]:rooms[roomName].router[1]
    console.log('createWebRtcTransport for consumer',consumer,'on Router :',router.id)
    createWebRtcTransport(router).then(
      transport => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          }
        })

        // add transport to Peer's properties
        addTransport(transport, roomName, consumer,OnRouter)
      },
      error => {
        console.log(error)
      })
  })

  const addTransport = (transport, roomName, consumer, OnRouter) => {

    transports = [
      ...transports,
      { socketId: socket.id, transport, roomName, consumer, OnRouter}
    ]
    // console.log('addTransport',transports)
    peers[socket.id] = {
      ...peers[socket.id],
      transports: [
        ...peers[socket.id].transports,
        transport.id,
      ]
    }
  }

  const addProducer = (producer, roomName,OnRouter) => {
    producers = [
      ...producers,
      { socketId: socket.id, producer, roomName, OnRouter}
    ]
    // console.log('addProducer',OnRouter)
    peers[socket.id] = {
      ...peers[socket.id],
      producers: [
        ...peers[socket.id].producers,
        producer.id,
      ],
      OnRouter_P: [
        ...peers[socket.id].OnRouter_P,
        OnRouter,
      ]
    }
  }
  const addPipe = (producer,consumer, roomName,Dir) => {
    pipeproducers = [
      ...pipeproducers,
      { socketId: socket.id, producer, roomName, Dir}
    ]
    pipeconsumers = [
      ...pipeconsumers,
      { socketId: socket.id, consumer, roomName, Dir}
    ]

    peers[socket.id] = {
      ...peers[socket.id],
      pipeproducers: [
        ...peers[socket.id].pipeproducers,
        producer.id,
      ],
      pipeconsumers: [
        ...peers[socket.id].pipeconsumers,
        consumer.id,
      ]
    }
  }

  const addConsumer = (consumer, roomName,OnRouter) => {
    // add the consumer to the consumers list
    consumers = [
      ...consumers,
      { socketId: socket.id, consumer, roomName, OnRouter,}
    ]

    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [
        ...peers[socket.id].consumers,
        consumer.id,
      ],
      OnRouter_C: [
        ...peers[socket.id].OnRouter_C,
        OnRouter,
      ]
    }
  }

  socket.on('getProducers', callback => {
    //return all producer transports
    const { roomName } = peers[socket.id]

    let producerList = {
      id: [],
      OnRouter:[],
    }
    // let producerList = []
    producers.forEach(producerData => {
      if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
        producerList = {
          ...producerList, 
          id: [
            ...producerList.id,
            producerData.producer.id,
          ],
          OnRouter: [
            ...producerList.OnRouter,
            producerData.OnRouter,
          ],
        }
        // producerList = [...producerList,producerData.producer.id]
      }
    })
    console.log('producerList',producerList)
    // return the producer list back to the client
    callback(producerList)
  })

  socket.on('getPipeProducers', callback => {
    //return all producer transports
    const { roomName } = peers[socket.id]

    let PipeproducerList = {
      id: [],
      Dir:[],
    }
    // let producerList = []
    pipeproducers.forEach(producerData => {
      if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
        PipeproducerList = {
          ...PipeproducerList, 
          id: [
            ...PipeproducerList.id,
            producerData.producer.id,
          ],
          Dir: [
            ...PipeproducerList.Dir,
            producerData.Dir,
          ],
        }
        // producerList = [...producerList,producerData.producer.id]
      }
    })
    console.log('Current PipeproducerList',PipeproducerList)
    // return the producer list back to the client
    callback(PipeproducerList)
  })

  const informConsumers = (roomName, socketId, id,onRouter) => {
    console.log(`${socketId} just join ${roomName} id ${id}`)
    // A new producer just joined
    // let all consumers to consume this producer
    if(onRouter)
    {
      producers.forEach(producerData => {
        if (producerData.socketId !== socketId && producerData.roomName === roomName) {
          const producerSocket = peers[producerData.socketId].socket
          // use socket to send producer id to producer
          producerSocket.emit('new-producer', { producerId: id })
        }
      })
    }
    else
    {
      pipeproducers.forEach(producerData => {
        if (producerData.socketId !== socketId && producerData.roomName === roomName) {
          const producerSocket = peers[producerData.socketId].socket
          // use socket to send producer id to producer
          producerSocket.emit('new-producer', { producerId: id })
        }
      })
    }
    
  }

  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer)
    return producerTransport.transport
  }

  // see client's socket.emit('transport-connect', ...)
  socket.on('transport-connect', ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters })
    
    getTransport(socket.id).connect({ dtlsParameters })
  })

  // see client's socket.emit('transport-produce', ...)
  socket.on('transport-produce', async ({ kind, rtpParameters, appData, OnRouter}, callback) => {
    // call produce based on the prameters from the client
    const producer = await getTransport(socket.id).produce({
      kind,
      rtpParameters,
    })

    // add producer to the producers array
    const { roomName } = peers[socket.id]
    addProducer(producer, roomName, OnRouter)

    // informConsumers(roomName, socket.id, producer.id,OnRouter)

    console.log('Producer ID: ', producer.id, producer.kind)

    producer.on('transportclose', () => {
      console.log('transport for this producer closed ')
      producer.close()
    })

    // Send back to the client the Producer's id
    callback({
      id: producer.id,
      producersExist: producers.length>1 ? true : false
    })
  })

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on('transport-recv-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`)
    const consumerTransport = transports.find(transportData => (
      transportData.consumer && transportData.transport.id == serverConsumerTransportId
    )).transport
    await consumerTransport.connect({ dtlsParameters })
  })

  socket.on('consume', async ({ rtpCapabilities, remoteProducerId, serverConsumerTransportId, OnRouter }, callback) => {
    try {
      const { roomName } = peers[socket.id]
      const router = OnRouter?rooms[roomName].router[0]:rooms[roomName].router[1]
      console.log('On ',router.id,'consume ',remoteProducerId)
      let consumerTransport = transports.find(transportData => (
        transportData.consumer && transportData.transport.id == serverConsumerTransportId
      )).transport

      // check if the router can consume the specified producer
      if (router.canConsume({
        producerId: remoteProducerId,
        rtpCapabilities
      })) {
        // transport can now consume and return a consumer
        const consumer = await consumerTransport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        })

        consumer.on('transportclose', () => {
          console.log('transport close from consumer')
        })

        consumer.on('producerclose', () => {
          console.log('producer of consumer closed')
          socket.emit('producer-closed', { remoteProducerId })

          consumerTransport.close([])
          transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
          consumer.close()
          consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)
        })

        addConsumer(consumer, roomName,OnRouter)

        // from the consumer extract the following params
        // to send back to the Client
        const params = {
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          serverConsumerId: consumer.id,
        }

        // send the parameters to the client
        callback({ params })
      }
    } catch (error) {
      console.log(error.message)
      callback({
        params: {
          error: error
        }
      })
    }
  })

  socket.on('consumer-resume', async ({ serverConsumerId }) => {
    console.log('consumer resume')
    const { consumer } = consumers.find(consumerData => consumerData.consumer.id === serverConsumerId)
    await consumer.resume()
  })

  socket.on('PipeToRouter', async(Producer,callback) => {
    const { roomName } = peers[socket.id]
    console.log('PipeToRouter Dir :',Producer.OnRouter)
    const From = Producer.OnRouter?rooms[roomName].router[0]:rooms[roomName].router[1]
    const To = Producer.OnRouter?rooms[roomName].router[1]:rooms[roomName].router[0]
    console.log('Pipe from ',From.id,' To ',To.id)
    // let producerList = []
    // producers.forEach(producerData => {
    //   if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
    //     producerList = [...producerList, producerData.producer.id]
    //   }
    // })
    console.log('Pipe which producer',Producer.id)
    const PipeID = await From.pipeToRouter({
      producerId:Producer.id,
      router:To
    })

//  console.log('PipeID',PipeID.pipeProducer.id,PipeID.pipeConsumer.id)

  addPipe(PipeID.pipeProducer,PipeID.pipeConsumer, roomName,Producer.OnRouter)
  informConsumers(roomName, socket.id, PipeID.pipeProducer.id,Producer.OnRouter)


  callback(PipeID)
  })
})

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: '140.118.107.208', // replace with relevant IP address
            announcedIp: '140.118.107.208',
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      }

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(webRtcTransport_options)
      console.log(`Create transport : ${transport.id}, on ${router.id}`)

      transport.on('dtlsstatechange', dtlsState => {
        if (dtlsState === 'closed') {
          transport.close()
        }
      })

      transport.on('close', () => {
        console.log('transport closed')
      })

      resolve(transport)

    } catch (error) {
      reject(error)
    }
  })
}