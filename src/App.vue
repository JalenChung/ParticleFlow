<script setup lang="ts">
import ParticleCanvas from './components/ParticleCanvas.vue';
</script>

<template>
  <ParticleCanvas />
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  /* 深蓝夜空底色，衬托浅色粒子 */
  background:
    radial-gradient(120% 90% at 50% 18%, #16243e 0%, #0b1220 62%, #070c16 100%);
}
</style>
