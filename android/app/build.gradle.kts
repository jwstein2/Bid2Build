import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing comes from android/keystore.properties (never committed) or CI environment variables.
val signing = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? = signing.getProperty(key) ?: System.getenv(env)

android {
    namespace = "org.built2bid.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.built2bid.app"
        minSdk = 29 // Android 10+: the first version with a separate "Allow all the time" location choice
        targetSdk = 36
        versionCode = (System.getenv("B2B_VERSION_CODE") ?: "1").toInt()
        versionName = "1.0.0"
        // The site the app opens. Staging builds can point elsewhere with -PbaseUrl=https://...
        val baseUrl = (project.findProperty("baseUrl") as String?) ?: "https://built2bid.org"
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
    }

    signingConfigs {
        create("release") {
            val store = signingValue("storeFile", "B2B_KEYSTORE_FILE")
            if (store != null) {
                storeFile = file(store)
                storePassword = signingValue("storePassword", "B2B_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "B2B_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "B2B_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signingValue("storeFile", "B2B_KEYSTORE_FILE") != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.work:work-runtime-ktx:2.10.3")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
}
