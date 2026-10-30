import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Keep release credentials outside the repository and never fall back to a
// debug key. With no credentials, Gradle can still build an unsigned bundle.
val uploadKey = listOf(
    "BLINKENBADGE_ANDROID_KEYSTORE",
    "BLINKENBADGE_ANDROID_KEY_ALIAS",
    "BLINKENBADGE_ANDROID_KEYSTORE_PASSWORD",
    "BLINKENBADGE_ANDROID_KEY_PASSWORD",
).associateWith { providers.environmentVariable(it).orNull }
val hasUploadKey = uploadKey.values.all { !it.isNullOrBlank() }
require(uploadKey.values.none { !it.isNullOrBlank() } || hasUploadKey) {
    "Set all four BLINKENBADGE_ANDROID signing variables or leave all unset."
}

android {
    compileSdk = 36
    namespace = "com.martin.blinkenbadge"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.martin.blinkenbadge"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                storeFile = file(requireNotNull(uploadKey["BLINKENBADGE_ANDROID_KEYSTORE"]))
                keyAlias = uploadKey["BLINKENBADGE_ANDROID_KEY_ALIAS"]
                storePassword = uploadKey["BLINKENBADGE_ANDROID_KEYSTORE_PASSWORD"]
                keyPassword = uploadKey["BLINKENBADGE_ANDROID_KEY_PASSWORD"]
            }
        }
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".dev"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (hasUploadKey) {
                signingConfig = signingConfigs.getByName("upload")
            }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
