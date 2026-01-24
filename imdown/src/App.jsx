import Calendar from './components/Calendar'
import './App.css'

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="container mx-auto">
        <h1 className="text-4xl font-bold text-center text-gray-800 mb-8">
          Scheduling App
        </h1>
        <Calendar />
      </div>
    </div>
  )
}

export default App
