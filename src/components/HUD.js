import React, { useState, useEffect } from 'react';

const HUD = () => {
  const [speed, setSpeed] = useState(0);
  const [nextTurn, setNextTurn] = useState('In 0.4 miles, turn left onto Elm St');
  const [eta, setEta] = useState('8:08 PM');
  const [distance, setDistance] = useState('9 mi');
  const [speedLimit, setSpeedLimit] = useState(45);

  useEffect(() => {
    // Simulate speed updates
    const interval = setInterval(() => {
      setSpeed(Math.floor(Math.random() * 60));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute bottom-0 w-full bg-gray-800 bg-opacity-80 text-white p-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          <div className="text-3xl font-bold">{speed}</div>
          <div className="ml-2">
            <div>mph</div>
            <div className="text-sm">Limit: {speedLimit}</div>
          </div>
        </div>
        <div className="text-center">
          <div>{nextTurn}</div>
          <div className="text-sm">{distance} • {eta}</div>
        </div>
        <div>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9" />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default HUD;
