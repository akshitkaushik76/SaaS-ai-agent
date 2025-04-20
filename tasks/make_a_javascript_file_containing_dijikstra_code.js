```
function dijkstra(graph, start) {
    const distances = {};
    const previous = {};

    for (const node in graph) {
        distances[node] = Infinity;
        previous[node] = null;
    }

    distances[start] = 0;

    const unvisitedNodes = Object.keys(graph);

    while (unvisitedNodes.length > 0) {
        const currentNode = unvisitedNodes[0];
        let currentNodeDistance = distances[currentNode];

        for (const neighbor in graph[currentNode]) {
            const newDistance = currentNodeDistance + graph[currentNode][neighbor];
            if (newDistance < distances[neighbor]) {
                distances[neighbor] = newDistance;
                previous[neighbor] = currentNode;
            }
        }

        unvisitedNodes.splice(unvisitedNodes.indexOf(currentNode), 1);
    }

    return distances;
}

module.exports = dijkstra;
```