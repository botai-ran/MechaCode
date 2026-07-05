import { FormEvent, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    try {
      const message = await invoke<string>("greet", {
        name: name.trim() || "Mecha"
      });
      setGreeting(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="title-bar">
          <div>
            <p className="eyebrow">Mecha Desktop</p>
            <h1>Tauri + React 18</h1>
          </div>
          <span className="status">Local</span>
        </header>

        <form className="command-panel" onSubmit={handleSubmit}>
          <label htmlFor="name">Name</label>
          <div className="input-row">
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter a name"
            />
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Calling" : "Greet"}
            </button>
          </div>
        </form>

        {greeting ? <p className="result">{greeting}</p> : null}
      </section>
    </main>
  );
}

export default App;
