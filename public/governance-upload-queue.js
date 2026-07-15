(function (global) {
  function createSequentialTaskQueue() {
    var tail = Promise.resolve();
    return function enqueue(task) {
      var run = tail.then(task, task);
      tail = run.then(function () {}, function () {});
      return run;
    };
  }

  global.createSequentialTaskQueue = createSequentialTaskQueue;
})(globalThis);
