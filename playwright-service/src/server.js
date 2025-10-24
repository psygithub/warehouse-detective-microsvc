const express = require('express');
const WarehouseDetective = require('./main');

const app = express();
const port = process.env.PORT || 3001; // Use a different port for this service

app.use(express.json());

// A simple health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// The main endpoint to run playwright tasks
app.post('/api/run-task', async (req, res) => {
  console.log('Received task request:', req.body);
  const { skus, regions } = req.body;

  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({ error: 'SKUs must be a non-empty array.' });
  }

  const detective = new WarehouseDetective();
  try {
    // The run method needs to be adapted to return results instead of saving/emailing them directly
    // For now, we assume the `run` method is adapted to return the results array.
    // This will require refactoring the `run` method in `main.js`.
    const results = await detective.run(skus, regions);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error executing task in playwright-service:', error);
    res.status(500).json({ success: false, error: 'Failed to execute task.', message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Playwright service listening on port ${port}`);
});
