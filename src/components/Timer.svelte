<script>
import ProgressBar from './ProgressBar.svelte';

const totalTime = 20;
let secondsLeft = totalTime;
let isDisabled = false;
let buttonClass = 'start';
let buttonLabel = 'Start';
$: progressPercentage = 100 - 100*(secondsLeft/totalTime);

function startTimer() {
    if(buttonLabel === 'Start') {
        controlButton(true);
        const timer = setInterval(() => {
            secondsLeft -= 1;
            if(secondsLeft === 0) {
                clearInterval(timer);
                controlButton(false);
            }
        }, 1000);
    } else {
        reset();
    }
}

function controlButton(disabled) {
    isDisabled = disabled;
    buttonClass = disabled ? 'start disabled' : 'start';
    buttonLabel = secondsLeft === 0 ? 'Reset' : 'Start';
}

function reset() {
    secondsLeft = totalTime;
    buttonLabel = 'Start';
}

</script>

<style>
    h2 {
        margin: 0;
    }
    .start {
        background-color: rgb(154, 73, 73);
        width: 100%;
        margin: 10px 0;
    }
    .disabled {
        background-color: rgb(192, 192, 192);
        cursor: not-allowed;
    }
</style>

<div bp="grid">
    <div bp="4@md"></div>    
    <h2 bp="4@md 12@sm">Time Left : {secondsLeft} sec</h2>
    <div bp="4@md"></div>
</div>

<ProgressBar {progressPercentage} />

<div bp="grid">
    <button bp="offset-5@md 4@md 12@sm" class="{buttonClass}" on:click="{startTimer}" disabled="{isDisabled}">{buttonLabel}</button>
</div>