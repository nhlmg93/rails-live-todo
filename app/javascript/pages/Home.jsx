export default function Home({ name }) {
  return (
    <div className="container">
      <h1>Welcome to Mirs V2</h1>
      <p>Hello, {name}!</p>
      <p>This is a Rails app with Inertia.js and React.</p>
    </div>
  )
}
