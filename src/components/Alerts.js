import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const Alerts = () => {
  const [alerts, setAlerts] = useState([]);
  const socket = useRef(null);

  useEffect(() => {
    socket.current = io('https://pinmap-website.onrender.com', { transports: ['websocket'] });
    socket.current.on('alert', (alert) => {
      setAlerts((prev) => [...prev, alert]);
      if (Notification.permission === 'granted') {
        new Notification(alert.message);
      }
    });

    Notification.requestPermission();

    return () => socket.current.disconnect();
  }, []);

  return (
    <div className="absolute top-0 w-full bg-yellow-500 bg-opacity-80 text-black p-2">
      {alerts.slice(-1).map((alert, index) => (
        <div key={index}>{alert.message}</div>
      ))}
    </div>
  );
};

export default Alerts;
