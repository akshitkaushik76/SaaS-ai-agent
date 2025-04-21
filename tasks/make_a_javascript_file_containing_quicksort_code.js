```
function quicksort(arr) {
  if (arr.length <= 1) return arr;
  var pivot = arr[0];
  var left = [];
  var right = [];
  for (var i = 1; i < arr.length; i++) {
    if (arr[i] <= pivot) left.push(arr[i]);
    else right.push(arr[i]);
  }
  return quicksort(left).concat([pivot], quicksort(right));
}

var arr = [5, 2, 8, 3, 1, 6, 4];
console.log(quicksort(arr));
```