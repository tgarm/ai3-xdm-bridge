<!-- src/components/LanguageSwitcher.vue -->
<template>
  <div class="language-switcher">
    <el-select v-model="locale" :placeholder="t('languageSwitcher.label')" size="small">
      <el-option
        v-for="lang in availableLocales"
        :key="`locale-${lang}`"
        :label="languageNames[lang]"
        :value="lang"
      />
    </el-select>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { watch } from 'vue';

const { t, locale, availableLocales } = useI18n();

// To display native language names in the dropdown
const languageNames = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  de: 'Deutsch',
};

// Watch for changes in the locale and save it to localStorage
watch(locale, (newLocale) => {
  localStorage.setItem('locale', newLocale);
});
</script>

<style scoped>
.language-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 84px;
  z-index: 1000;
}
.switcher-label {
  font-size: 14px;
}
</style>
