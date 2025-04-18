import React from 'react';
import Map from './components/Map';
import HUD from './components/HUD';
import Alerts from './components/Alerts';
import './styles.css';

function App() {
  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      <Map />
      <HUD />
      <Alerts />
    </div>
  );
}

export default App;
