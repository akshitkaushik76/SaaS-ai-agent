```
function quicksort(array) {
  if (array.length <= 1) {
    return array;
  }

  let pivot = array[0];
  let less = [];
  let greater = [];

  for (let i = 1; i < array.length; i++) {
    if (array[i] <= pivot) {
      less.push(array[i]);
    } else {
      greater.push(array[i]);
    }
  }

  return quicksort(less).concat(pivot, quicksort(greater));
}

module.exports = quicksort;
```