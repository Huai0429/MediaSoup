//server side
import express from 'express'
const app = express()

import https from 'httpolyglot'
import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()

import {Server} from 'socket.io'
import mediasoup from 'mediasoup'
import { SocketAddress } from 'net'
import e from 'express'
import { send } from 'process'
import { resolveObjectURL } from 'buffer'
import { randomFillSync } from 'crypto'
import { profile } from 'console'

app.get('/',(req,res)=>{
    res.send('Hello from mediasoup app')
})

app.use('/sfu',express.static(path.join(__dirname,'public')))

const options = {
    key: fs.readFileSync('./server/ssl/key.pem','utf-8'),
    cert: fs.readFileSync('./server/ssl/cert.pem','utf-8')

}

const  httpsServer = https.createServer(options,app)
httpsServer.listen(3000,() => {
    console.log('listening on port: '+3000)
})

const io = new Server(httpsServer)

const peers = io.of('/mediasoup')




//worker 

let worker 

//worker's RTCport
const  createWorker = async()=>{
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    })
    console.log(`worker pid ${worker.pid}`)

    worker.on('died',error => {
        console.error('mediasoup worker has died')
        setTimeout(()=> process.exit(1),2000)//exit in 2 sec
    })
    return worker
}
worker = createWorker()

const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate:48000,
        channels:2,
    },
    {
        kind:'video',
        mimeType:'video/VP8',
        clockRate:90000,
        parameters:{
            'x-google-start-bitrate':1000,
        },
    },
]

//router
let router 

//client connect & disconnect
peers.on('connection' , async socket => { //'connection' event on peers
    console.log('"Connection" Event from app.js'),
    console.log(socket.id)
    socket.emit('connection-success',{ //emit back 'connection-success' link to index.js
        socketId: socket.id
    })

    socket.on('disconnect',()=>{
        //do some clean up
        console.log('peer disconnect')
    })
    router = await worker.createRouter({mediaCodecs})

    // call from 'const getRtpCapabilities' from index.js
    socket.on('getRtpCapabilities',(callback)=>{  
        const rtpCapabilities = router.rtpCapabilities
        console.log('"getRtpCapabilities" Event from app.js')
        // console.log('rtp Capabilities',rtpCapabilities)

        callback({rtpCapabilities}) // call back for emit in index.js 
    })

    //call from const createSendTransport (button 3)
    socket.on('createWebRtcTransport',async ({sender},callback)=>{
        console.log(`Is this a sender request? ${sender}`)
        if(sender)
            producerTransport = await createWebRtcTransport(callback)
        else 
            consumerTransport = await createWebRtcTransport(callback)

    })
let producer
    socket.on('transport-connect',async({dtlsParameters})=>{
        console.log('DTLS PARAMS...',[dtlsParameters])
        await producerTransport.connect({dtlsParameters})
    })

    socket.on('transport-produce',async({kind,rtpParameters,appData},callback)=>{
        producer = await producerTransport.produce({
            kind,
            rtpParameters,    
        })

        console.log('Producer ID: ',producer.id,producer.kind)
        producer.on('transportclose',()=>{
            console.log('transport for this producer closed ')
            producer.close()
        })

        callback({
            id : producer.id
        })
    })
})

//producer transport
let producerTransport
let consumerTransport
//createWebRtcTransport
const createWebRtcTransport = async(callback)=>{
    try {
        const webRtcTransport_options = {
            listenIps:[
                {
                    ip: '127.0.0.1',
                }
            ],
            enableUdp:true,
            enableTcp:true,
            preferUdp:true,
        }
        let transport = await router.createWebRtcTransport(webRtcTransport_options)
        console.log(`Create WebRtc Transport id: ${transport.id}`)
        transport.on('dtlsstatechange',dtlsState=>{
            if(dtlsState=='closed'){
                transport.close()
            }
        })

        transport.on('close',()=>{
            console.log('transport closed')
        })
        callback({ // callback to const createSendTranspor in index.js
            params:{
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            }
        })

        return transport
    }catch(error){
        console.log(error)
        callback({
            params:{
                error:error
            }
        })
    }
}