import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import io from 'socket.io-client';

const Map = () => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [route, setRoute] = useState(null);
  const socket = useRef(null);

  useEffect(() => {
    map.current = L.map(mapContainer.current, {
      center: [40.7128, -74.0060], // Default: NYC
      zoom: 14,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);

    // Get user's location
    navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCurrentPosition([latitude, longitude]);
        map.current.setView([latitude, longitude], 14);
        L.marker([latitude, longitude]).addTo(map.current);
      },
      (err) => console.error(err),
      { enableHighAccuracy: true }
    );

    // Fetch navigation route
    const fetchRoute = async () => {
      if (currentPosition) {
        const res = await fetch(`https://pinmap-website.onrender.com/api/route?start=${currentPosition.join(',')}&end=40.7128,-74.0060`);
        const data = await res.json();
        if (data.paths && data.paths[0]) {
          setRoute(data.paths[0].points);
          speakNavigation(data.paths[0].instructions[0]?.text || 'Start navigation');
        }
      }
    };

    if (currentPosition) fetchRoute();

    // WebSocket for alerts
    socket.current = io('https://pinmap-website.onrender.com', { transports: ['websocket'] });
    socket.current.on('connect', () => console.log('Connected to WebSocket'));
    socket.current.on('alert', (alert) => {
      console.log('New alert:', alert);
    });

    return () => {
      socket.current.disconnect();
      map.current.remove();
    };
  }, [currentPosition]);

  useEffect(() => {
    if (route && map.current) {
      L.polyline(route.coordinates.map(coord => [coord[1], coord[0]]), {
        color: '#3b82f6',
        weight: 6,
      }).addTo(map.current);
    }
  }, [route]);

  const speakNavigation = (instruction) => {
    const utterance = new SpeechSynthesisUtterance(instruction);
    window.speechSynthesis.speak(utterance);
  };

  return <div ref={mapContainer} className="flex-1" />;
};

export default Map;
