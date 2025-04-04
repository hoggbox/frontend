const mongoose = require('mongoose');
const TrafficCamera = require('../models/trafficCamera');

mongoose.connect('mongodb+srv://imhoggbox:snake1988@cluster0.xoo6m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', { useNewUrlParser: true, useUnifiedTopology: true });

const cameras = [
  {
    cameraId: 'traffic-cam-1',
    description: 'Traffic Camera - Hwy 441 & 29',
    latitude: 33.0801,
    longitude: -83.2321,
    imageUrl: 'https://via.placeholder.com/320x240.png?text=Traffic+Cam+Hwy+441'
  },
  {
    cameraId: 'traffic-cam-2',
    description: 'Traffic Camera - N Columbia St',
    latitude: 33.0900,
    longitude: -83.2250,
    imageUrl: 'https://via.placeholder.com/320x240.png?text=Traffic+Cam+N+Columbia'
  }
];

async function seed() {
  await TrafficCamera.deleteMany({});
  await TrafficCamera.insertMany(cameras);
  console.log('Traffic cameras seeded');
  mongoose.connection.close();
}

seed();
