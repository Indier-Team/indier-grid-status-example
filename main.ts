// @deno-types="npm:@types/express@4.17.15"
import express from "npm:express@4.18.2";
import cors from "npm:cors";

import { v1 } from "https://deno.land/std/uuid/mod.ts";

const app = express();
const kv = await Deno.openKv();

app.use(cors());
app.use(express.json());

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  owner: string;
}

// Middleware para verificar o header x-channel
app.use((req, res, next) => {
  const channel = req.headers['x-channel'];
  if (!channel) {
    return res.status(400).json({ error: 'x-channel header is required' });
  }
  next();
});

// Endpoint para adicionar uma nova tarefa
app.post('/todos', async (req, res) => {
  const { title } = req.body;
  const owner = req.headers['x-channel'] as string;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const id = v1.generate();
  const todo: Todo = { id, title, completed: false, owner };

  await kv.set(['todos', owner, id], todo);

  res.status(201).json(todo);
});

// Endpoint para listar todas as tarefas de um usuário
app.get('/todos', async (req, res) => {
  const owner = req.headers['x-channel'] as string;
  const todos: Todo[] = [];

  const records = kv.list({ prefix: ['todos', owner] });
  for await (const entry of records) {
    todos.push(entry.value as Todo);
  }

  res.json(todos);
});

// Endpoint para atualizar uma tarefa
app.put('/todos/:id', async (req, res) => {
  const { id } = req.params;
  const { title, completed } = req.body;
  const owner = req.headers['x-channel'] as string;

  const todoKey = ['todos', owner, id];
  const todo = await kv.get<Todo>(todoKey);

  if (!todo.value) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  const updatedTodo: Todo = {
    ...todo.value,
    title: title ?? todo.value.title,
    completed: completed ?? todo.value.completed,
  };

  await kv.set(todoKey, updatedTodo);

  res.json(updatedTodo);
});

// Endpoint para deletar uma tarefa
app.delete('/todos/:id', async (req, res) => {
  const { id } = req.params;
  const owner = req.headers['x-channel'] as string;

  const todoKey = ['todos', owner, id];
  const todo = await kv.get<Todo>(todoKey);

  if (!todo.value) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  await kv.delete(todoKey);

  res.status(204).end();
});

app.listen(Deno.env.get("PORT") || 3000, () => {
  console.log(`Server is running on port ${Deno.env.get("PORT") || 3000}`);
});
